const cdk = require('@aws-cdk/cdk');
const ec2 = require('@aws-cdk/aws-ec2');
const ecs = require('@aws-cdk/aws-ecs');
const s3 = require('@aws-cdk/aws-s3');
const sqs = require('@aws-cdk/aws-sqs');
const dynamodb = require('@aws-cdk/aws-dynamodb');
const iam = require('@aws-cdk/aws-iam');

class BaseResources extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    // Create a network for the application to run in
    this.vpc = new ec2.VpcNetwork(this, 'vpc', {
      maxAZs: 2,
      natGateways: 1
    });

    // Create an ECS cluster
    this.cluster = new ecs.Cluster(this, 'cluster', {
      vpc: this.vpc
    });

    // Create S3 bucket
    this.screenshotBucket = new s3.Bucket(this, 'screenshot-bucket', {
      publicReadAccess: false
    });

    // Create queue
    this.screenshotQueue = new sqs.Queue(this, 'screenshot-queue');

    // Create DynamoDB table
    this.screenshotTable = new dynamodb.Table(this, 'screenshots', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.String },
      billingMode: dynamodb.BillingMode.PayPerRequest
    });
  }
}

class API extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    // Create an API service
    this.api = new ecs.LoadBalancedFargateService(this, 'api', {
      cluster: props.cluster,
      image: ecs.ContainerImage.fromAsset(this, 'api-image', {
        directory: './api'
      }),
      desiredCount: 2,
      cpu: '256',
      memory: '512',
      environment: {
        QUEUE_URL: props.screenshotQueue.queueUrl,
        TABLE: props.screenshotTable.tableName,
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR'
      },
      createLogs: true
    });

    props.screenshotQueue.grantSendMessages(this.api.service.taskDefinition.taskRole);
    props.screenshotTable.grantReadWriteData(this.api.service.taskDefinition.taskRole);

    this.api.service.taskDefinition.taskRole.addToPolicy(new iam.PolicyStatement()
      .addAction('xray:PutTraceSegments')
      .allow()
      .addResource('*')
    )

    this.api.service.taskDefinition.addContainer('xray', {
      image: ecs.ContainerImage.fromRegistry('amazon/aws-xray-daemon')
    }).addPortMappings({
      containerPort: 2000,
      protocol: ecs.Protocol.Udp
    })

    // vueApp front end 
    this.vueAppDefinition = new ecs.FargateTaskDefinition(this, 'vueApp-definition', {
      cpu: '2048',
      memoryMiB: '4096'
    });

    this.vueAppDefinition.addContainer('vueApp', {
      image: ecs.ContainerImage.fromAsset(this, 'vueapp-image', {
        directory: './vueapp'
      }),
      cpu: 2048,
      memoryLimitMiB: 4096,
      environment:{
        ALBDNS: this.api.loadBalancer.dnsName
      },
      logging: new ecs.AwsLogDriver(this, 'vueApp-logs', {
        streamPrefix: 'vueApp'
      })
    }).addPortMappings({
      containerPort: 80
    })


    this.vueAppService = new ecs.FargateService(this, 'vueApp-service', {
      cluster: props.cluster,
      desiredCount: 1,
      taskDefinition: this.vueAppDefinition
    });

    this.api.listener.addTargets('vue', {
      port: 80,
      pathPattern: "/app*",
      priority: 100,
      healthCheck: {
        "port": 'traffic-port',
        "path": '/',
        "intervalSecs": 30,
        "timeoutSeconds": 5,
        "healthyThresholdCount": 5,
        "unhealthyThresholdCount": 2,
        "healthyHttpCodes": "200,301,302"
      },
      targets: [this.vueAppService]
    })

  }
}

class Worker extends cdk.Stack {
  constructor(parent, id, props) {
    super(parent, id, props);

    // Create a worker service
    this.workerDefinition = new ecs.FargateTaskDefinition(this, 'worker-definition', {
      cpu: '2048',
      memoryMiB: '4096'
    });

    this.container = this.workerDefinition.addContainer('worker', {
      image: ecs.ContainerImage.fromAsset(this, 'worker-image', {
        directory: './worker'
      }),
      cpu: 2048,
      memoryLimitMiB: 4096,
      environment: {
        QUEUE_URL: props.screenshotQueue.queueUrl,
        TABLE: props.screenshotTable.tableName,
        BUCKET: props.screenshotBucket.bucketName,
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR'
      },
      logging: new ecs.AwsLogDriver(this, 'worker-logs', {
        streamPrefix: 'worker'
      })
    });

    this.worker = new ecs.FargateService(this, 'worker', {
      cluster: props.cluster,
      desiredCount: 2,
      taskDefinition: this.workerDefinition
    });

    props.screenshotQueue.grantConsumeMessages(this.workerDefinition.taskRole);
    props.screenshotTable.grantReadWriteData(this.workerDefinition.taskRole);
    props.screenshotBucket.grantReadWrite(this.workerDefinition.taskRole);

    this.workerDefinition.addContainer('xray', {
      image: ecs.ContainerImage.fromRegistry('amazon/aws-xray-daemon'),
      logging: new ecs.AwsLogDriver(this, 'xray-worker-logs', {
        streamPrefix: 'xray-worker'
      })
    }).addPortMappings({
      containerPort: 2000,
      protocol: ecs.Protocol.Udp
    })

    //xray
    this.workerDefinition.taskRole.addToPolicy(
      new iam.PolicyStatement()
        .addAction('xray:PutTraceSegments')
        .allow()
        .addResource('*')
    )

  }
}

class App extends cdk.App {
  constructor(argv) {
    super(argv);

    this.baseResources = new BaseResources(this, 'base-resources');

    this.api = new API(this, 'api', {
      cluster: this.baseResources.cluster,
      screenshotQueue: this.baseResources.screenshotQueue,
      screenshotTable: this.baseResources.screenshotTable
    });

    this.worker = new Worker(this, 'worker', {
      cluster: this.baseResources.cluster,
      screenshotQueue: this.baseResources.screenshotQueue,
      screenshotTable: this.baseResources.screenshotTable,
      screenshotBucket: this.baseResources.screenshotBucket
    });
  }
}

new App().run();
