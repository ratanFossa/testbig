---
id: version-1.12.0-interfaces
title: Cumulus Interfaces
hide_title: true
original_id: interfaces
---

# Cumulus Interfaces

Cumulus has multiple interfaces that allow interaction with discrete components of the system, such as starting workflows via SNS or Kinesis, manually queueing workflow start messages, submitting SNS notifications for completed workflows, and the many operations allowed by the Cumulus API.

The diagram below documents the workflow process in detail and the various interfaces that allow starting of workflows, reporting of completed workflows, and API create operations that occur when a workflow completion message is processed. Inline hyperlinks to further documentation are provided where available.

Hovering over the red text will pop up small windows that document the various schemas where applicable, with links to the most recent copy in the Cumulus source code. These schemas also include all optional fields that are shown on the Cumulus dashboard.

Note: this diagram is current of v1.11.1.
<br /><br />

<div style="position:relative">
  <span class="diagram-overlay-text" style="left:60px;top:-20px"><a id="trigs">WORKFLOW TRIGGERS</a></span>
  <span class="diagram-overlay-text" style="top:-20px;left:610px;">REPORTING</span>
  <img src="/cumulus/docs/assets/interface_diagram.png" style="min-width:800px;max-width:800px;height:auto" />
  <div class="diagram-overlay-text" style="top:20px;left:30px">
    SNS<br />Message
  </div>
  <div class="diagram-overlay-text red-text" style="top:65px;left:40px;font-size:0.8em;">
    Interface
    <div class="default-text">
      Populates <span class="red-text">payload</span> field of workflow input.
      <table>
        <tr>
          <th>SNS Schema</th>
          <th><a href="https://github.com/nasa/cumulus/blob/master/packages/api/lambdas/kinesis-consumer-event-schema.json">Kinesis Schema</a></th>
        </tr>
        <tr>
          <td><pre><code>N/A</code></pre></td>
          <td><pre><code>{
  "$async": true,
  "properties": {
    "collection": {
      "type": "string"
    }
  },
  "required": ["collection"]
}</code></pre></td>
        </tr>
      </table>
    </div>
  </div>
  <div class="diagram-overlay-text" style="top:85px;left:30px">
    Kinesis<br />Streams
  </div>
  <div class="diagram-overlay-text" style="top:145px;left:30px">
    Onetime &<br />Scheduled<br />Rule<br />(Cloud-<br />Watch)
  </div>
  <div class="diagram-overlay-text red-text" style="top:140px;left:632px;font-size:0.8em;">
    Interface
    <div class="default-text" style="top:-350px">
      <table>
        <tr>
          <th>Granule Schema</th>
        </tr>
        <tr>
          <td><pre><code>{
  "cumulus_meta": {
    "execution_name": "string",
    "state_machine": "string",
    "workflow_start_time": "number"
  },
  "meta": {
    "collection": {
      "name": "string",
      "version": "string"
    },
    "pdr": {
      "name": "string"
    },
    "provider": {
      "id": "string"
    },
    "status": "string"
  },
  "payload": {
    "granules": [
      {
        "granuleId": "string",
        "cmrLink": "string",
        "files": [
          {
            "bucket": "string",
            "key": "string",
            "fileName": "string"
          }
        ],
        "published": "boolean"
      }
    ]
  },
  "exception": {}
}</code></pre></td>
        </tr>
      </table>
    </div>
  </div>
  <div class="diagram-overlay-text red-text" style="top:140px;left:715px;font-size:0.8em;">
    Interface
    <div class="default-text" style="top:-250px">
      <table>
        <tr>
          <th>PDR Schema</th>
        </tr>
        <tr>
          <td><pre><code>{
  "cumulus_meta": {
    "execution_name": "string",
    "state_machine": "string",
    "workflow_start_time": "number"
  },
  "meta": {
    "collection": {
      "name": "string",
      "version": "string"
    },
    "provider": {
      "id": "string"
    },
    "status": "string"
  },
  "payload": {
    "pdr": {
      "name": "string",
      "PANSent": "boolean",
      "PANmessage": "string"
    },
    "running": [],
    "completed": [],
    "failed": []
  }
}</code></pre></td>
        </tr>
      </table>
    </div>
  </div>
  <div class="diagram-overlay-text red-text" style="top:140px;left:550px;font-size:0.8em;">
    Interface
    <div class="default-text" style="top:-150px">
      <table>
        <tr>
          <th>Execution Schema</th>
        </tr>
        <tr>
          <td><pre><code>{
  "cumulus_meta": {
    "execution_name": "string",
    "parentExecutionArn": "string",
    "state_machine": "string",
    "workflow_start_time": "number"
  },
  "meta": {
    "collection": {
      "name": "string",
      "version": "string"
    },
    "status": "string",
    "workflow_name": "string",
    "workflow_tasks": {}
  },
  "exception": {}
}</code></pre></td>
        </tr>
      </table>
    </div>
  </div>
  <div class="diagram-overlay-text" style="top:45px;left:180px">
    Message<br />Consumer
  </div>
  <div class="diagram-overlay-text" style="top:203px;left:170px">
    SFStarter SQS
  </div>
  <div class="diagram-overlay-text red-text" style="top:240px;left:190px;font-size:0.8em;">
    Interface
    <div class="default-text" style="bottom:0">
      <table>
        <tr>
          <th>StartSF Schema</th>
        </tr>
        <tr>
          <td>
            <a id="msgFmt">Cumulus Message Format</a>
          </td>
        </tr>
      </table>
    </div>
  </div><div class="diagram-overlay-text" style="top:185px;left:377px">
    <a id="wFlow">Cumulus<br />Workflow</a>
  </div>
  <div class="diagram-overlay-text" style="top:35px;left:610px">
    <a href="https://nasa.github.io/cumulus-api/">Cumulus API</a>
  </div>
  <div class="diagram-overlay-text" style="top:95px;left:540px">
    <span>Execution</span>
  </div>
  <div class="diagram-overlay-text" style="top:95px;left:630px">
    <span>Granule</span>
  </div>
  <div class="diagram-overlay-text" style="top:95px;left:725px">
    <span>PDR</span>
  </div>
  <div class="diagram-overlay-text" style="top:210px;left:605px">
    SFTracker SNS
  </div>
  <div class="diagram-overlay-text red-text" style="top:240px;left:630px;font-size:0.8em;">
    Interface
    <div class="default-text" style="bottom:0;right:0">
      <table>
        <tr>
          <th>
            SFTracker Schema
          </th>
        </tr>
        <tr>
          <td>
            The message schema is identical to the three API interface schemas documented above. The execution schema is expected to be met, the others are optional.
          </td>
        </tr>
      </table>
    </div>
  </div>
</div>

<script type="text/javascript">
var hostpath = window.location.href.substring(0, window.location.href.lastIndexOf('/')+1);
document.getElementById('trigs').setAttribute('href', hostpath+'workflows/workflow-triggers');
document.getElementById('msgFmt').setAttribute('href', hostpath+'workflows/cumulus-task-message-flow#cumulus-message-format');
document.getElementById('wFlow').setAttribute('href', hostpath+'workflows/workflows-readme');
</script>
