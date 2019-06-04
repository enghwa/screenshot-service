<template>
  <div id="app">
    <h2>Take A Screenshot</h2>
    
    <input id="inputurl" type="text" v-model.lazy="inputurl" width="40">
    <button id="btn" class v-on:click="sendJob(inputurl)">Go!</button>
    <br>
      <div v-if="job.status !='...'">The Job id = {{ jobid }} and status is {{ job.status }} </div>
    <br>
    <img alt="screenshot" v-bind:src="job.uri" width="60%">
  </div>
</template>

<script>
import axios from "axios";

export default {
  name: "app",
  data() {
    return {
      pollInterval: null,
      albDNS : "api-apilb28-1qcmefau59561-500931636.ap-southeast-1.elb.amazonaws.com", // process.env.API_URL,
      inputurl: "https://www.flickr.com",
      jobid: null,
      job: {
        status: "...",
        uri:"./fargate.png"
      }
    };
  },
  methods: {
    sendJob: function(inputurl) {
      axios
        .post(
          `http://${this.albDNS}/job`,{
            uri: inputurl
          }
        )
        .then(response => {
          this.jobid = response.data.id;
          this.job.uri = "./spinner.gif";

          //start polling
          this.pollInterval = setInterval(
            function() {
              this.fetchJob(this.jobid);
            }.bind(this),
            1000
          );
        });
    },
    beforeDestroy: function() {
      clearInterval(this.pollInterval);
    },

    fetchJob: function(jobid) {
      axios
        .get(
          `http://${this.albDNS}/job/` + jobid
        )
        .then(response => {
          //check status
          this.job.status = response.data.status;
          if (response.data.status == "done") {
            clearInterval(this.pollInterval); //won't be polled anymore
            this.job.uri = response.data.uri;
          }
        });
    }
  },
  mounted() {},
  components: {
    // HelloWorld
  }
};
</script>

<style>
#app {
  font-family: "Avenir", Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
  margin-top: 60px;
}
input {
  padding: .3rem 1rem;
  border: 1px solid #CCCCCC;
  outline: none;
  width: 40%;
  font-size: 14px;
  text-align: center;
}
button {
  font-size: 18px;
}
</style>
