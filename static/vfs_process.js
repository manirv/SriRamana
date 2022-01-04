
const NUM_KEYPOINTS = 468;
const NUM_IRIS_KEYPOINTS = 5;
const GREEN = '#7CFC00';
const RED = '#FF2C35';
const BLUE = '#157AB3';
const ORANGE = '#eb9748';
let review = false;
let stopRendering = true;

function isMobile() {
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isiOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  return isAndroid || isiOS;
}

function distance(a, b) {
  return Math.sqrt(Math.pow(a[0] - b[0], 2) + Math.pow(a[1] - b[1], 2));
}

let model, ctx, ctx2, videoWidth, videoHeight, video, canvas, canvas2, stream,
  scatterGLHasInitialized = false, scatterGL, rafID;

const VIDEO_SIZE = 500;
const mobile = isMobile();
const stats = new Stats();
const state = {
  backend: mobile ? 'wasm' : 'webgl',
  showFacemesh: false,
  showMetrics: false
};

// Create GUI   
gui = new dat.GUI({ autoPlace: false, width: 205 });
var customContainer = $('.moveGUI').append($(gui.domElement));
gui.domElement.style.visibility = "hidden";

function setupDatGui() {
  gui.add(state, 'showMetrics');
  gui.add(state, 'showFacemesh');
}

async function setupCamera() {
  video = document.getElementById('video');

  stream = await navigator.mediaDevices.getUserMedia({
    'audio': true,
    'video': {
      facingMode: 'user',
      width: mobile ? undefined : VIDEO_SIZE,
      height: mobile ? undefined : VIDEO_SIZE
    },
  });
  video.srcObject = stream;

  return new Promise((resolve) => {
    video.onloadedmetadata = () => {
      resolve(video);
    };
  });
}

let counter = 0;

function three_diff(a, b) {
  var diff = b.map(function (item, index) {
    return item - a[index];
  })
  return diff;
}

function distanceVector(diff) {
  var dx = diff[0];
  var dy = diff[1];
  var dz = diff[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function get_attention_value_mp(keypoints) {
  var left_end = keypoints[263];
  var right_end = keypoints[33];

  var right_end2 = keypoints[173];
  var right_top = keypoints[159];
  var right_bottom = keypoints[145];

  if (keypoints.length > NUM_KEYPOINTS) {
    const leftCenter = keypoints[NUM_KEYPOINTS];
    if (keypoints.length > NUM_KEYPOINTS + NUM_IRIS_KEYPOINTS) {
      const rightCenter = keypoints[NUM_KEYPOINTS + NUM_IRIS_KEYPOINTS];
      var diff_leftend = three_diff(left_end, leftCenter);
      var dist_leftend = distanceVector(diff_leftend);
      var diff_rightend = three_diff(rightCenter, right_end);
      var dist_rightend = distanceVector(diff_rightend);

      var diff_rightside = three_diff(right_end, right_end2);
      var dist_rightside = distanceVector(diff_rightside);
      var diff_righttop = three_diff(right_top, right_bottom);
      var dist_righttop = distanceVector(diff_righttop);

      var iris_dist_ratio = (dist_leftend - dist_rightend) / (dist_leftend + dist_rightend);
      var iris_lowered = dist_righttop / dist_rightside;

      if (iris_dist_ratio > 0.2) {
        ear_msg = "Right";
        attention_value = 0;
      }
      else if (iris_dist_ratio < -0.1) {
        ear_msg = "Left";
        attention_value = 0;
      }
      else {
        ear_msg = "Straight";
        attention_value = 1;
      }

      if (iris_lowered < 0.38) {
        ear_msg = "Lowered";
        attention_value = 0;
      }
    }
  }
  return { att_value: attention_value, msg: ear_msg }
}

function get_head_orientation_mp(keypoints) {
  left_ear = keypoints[454];
  right_ear = keypoints[234];
  nose = keypoints[1];
  mid_x = (right_ear[0] + left_ear[0]) / 2;
  mid_y = (right_ear[1] + left_ear[1]) / 2;
  mid_z = (right_ear[2] + left_ear[2]) / 2;
  mid = [mid_x, mid_y, mid_z];

  var nose_vector = mid.map(function (item, index) {
    return item - nose[index];
  })
  var unit_vector = [1, 1, 1];
  var norm_nose_vec = math.norm(nose_vector);
  var nose_angle = Math.acos(math.dot(unit_vector, nose_vector) / norm_nose_vec);
  var head_msg = '';
  var level = 0;
  var angle_diff = math.abs(nose_angle - 1.57);
  if (angle_diff > 0.5 && angle_diff < 1.4) {
    // Additional condition for accuracy: && nose[0] < 300 && nose[0] > 220 && nose[1] < 335 && nose[1] > 240 && nose[2] < -31
    level = 0;
    head_msg = "Straight";
    kr = angle_diff / 1.4;
    kg = 1 - kr;
  }
  else {
    level = 1;
    head_msg = "Tilted to side";
    kr = 1;
    kg = 0;
  }
  return { angle: angle_diff, lvl: level, msg: head_msg, kr, kg }
}

function uploadVfsScore(res_json, filename = 'res.json') {
  var request = new XMLHttpRequest();
  request.onload = function () {
    console.log(request.responseText);
  };
  request.open("POST", "/submit_result");
  request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
  request.send(res_json);
}

var framenum = 0;
var hmtcount = hmscount = emscount = emlcount = emlowcount = emrcount = bmgcount = bmlcount = emotscount = emotncount = emotnscount = 0;

//async function checkEmotion(video) {
//  const displaySize = { width: video.width, height: video.height }
//  var exp_value = 0;
// console.log('Before printing stuff');
// const detections = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions()).withFaceExpressions()
// try {
//    if (detections.expressions.happy > 0.5) {
//     exp_value = 0
//    } else if (detections.expressions.neutral > 0.5) {
//      exp_value = 1
//   } else {
//      exp_value = 2
//   }
// } catch (e0) {
//   console.log('Unable to get emotion from face: ');
// }

// return exp_value;
//} 

async function renderPrediction() {

  if (!review) {
    if (state.showMetrics) {
      canvas.hidden = false;
      canvas2.hidden = true;
    }
    else {
      canvas.hidden = true;
      canvas2.hidden = false;
      ctx2.setTransform(1, 0, 0, 1, 0, 0);
      ctx2.drawImage(
        video, 0, 0, videoWidth, videoHeight, 0, 0, canvas.width, canvas.height);
      if (stopRendering == false) {
        ctx2.beginPath();
        ctx2.arc(460, 23, 7, 0, 2 * Math.PI);
        ctx2.fillStyle = RED;
        ctx2.fill();
        ctx2.font = "20px Arial bold";
        ctx2.fillText('REC  ', 400, 30);
      }
    }
  }
  if (stopRendering) {
    ctx.drawImage(
      video, 0, 0, videoWidth, videoHeight, 0, 0, canvas.width, canvas.height);
  }

  stats.begin();
  const predictions = await model.estimateFaces({
    input: video,
    returnTensors: false,
    flipHorizontal: false
  });
  // var emo_value = await checkEmotion(video);
  var emo_value = 0;

  total_height = video.videoHeight;
  total_width = video.videoWidth;

  text_left = total_width * 1 / 10
  text_top = total_height * 9 / 10
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  //ctx.scale(-1, 1);
  ctx.drawImage(
    video, 0, 0, videoWidth, videoHeight, 0, 0, canvas.width, canvas.height);
  //ctx.restore();

  if (predictions.length > 0) {
    predictions.forEach(prediction => {
      const keypoints = prediction.scaledMesh;
      const bb = prediction.boundingBox;

      //Get Brightness of the video frame
      var colorSum = 0;
      var imageData = ctx.getImageData(0, 0, canvas.width, keypoints[152][1]);
      var data = imageData.data;
      var r, g, b, avg;

      for (var x = 0, len = data.length; x < len; x += 4) {
        r = data[x];
        g = data[x + 1];
        b = data[x + 2];

        avg = Math.floor((r + g + b) / 3);
        colorSum += avg;
      }

      var brightness = Math.floor(colorSum / (video.width * keypoints[152][1]));
      var getheadorient = get_head_orientation_mp(keypoints);
      var angle = getheadorient.angle;
      var head_msg = getheadorient.msg;
      var kr = getheadorient.kr;
      var kg = getheadorient.kg;

      // draw a head_orientation indicator
      ctx.beginPath();
      ctx.arc(490, 440, 7, 0, 2 * Math.PI);
      ctx.fillStyle = `rgb(${Math.floor(kr * 255)}, ${Math.floor(kg * 255)}, 0)`;
      ctx.fill();

      ctx.font = "20px Arial bold";
      if (head_msg == "Tilted to side") {
        ctx.fillStyle = ORANGE;
      }
      else {
        ctx.fillStyle = GREEN;
      }
      ctx.fillText('Head position : ' + head_msg, 250, 445);

      var getatt = get_attention_value_mp(keypoints);
      var att_value = getatt.att_value;
      var earmsg = getatt.msg;

      if (earmsg == "Straight") {
        ctx.fillStyle = GREEN;
      }
      else {
        ctx.fillStyle = ORANGE;
      }
      ctx.fillText('Eyes : ' + earmsg, 30, 445);

      if (brightness < 100) {
        brightmsg = "Low";
        ctx.fillStyle = ORANGE;
      }
      else {
        brightmsg = "Good";
        ctx.fillStyle = GREEN;
      }
      ctx.fillText('Brightness : ' + brightmsg, 250, 475);

      var emotion = earmsg;
      if (emo_value == 0) {
        emotmsg = "Smiling";
        ctx.fillStyle = GREEN;
      }
      else if (emo_value == 1) {
        emotmsg = "Neutral";
        ctx.fillStyle = ORANGE;
      }
      else {
        emotmsg = "Not smiling";
        ctx.fillStyle = RED;
      }
      ctx.fillText('Emotion : ' + emotmsg, 30, 475);

      if (stopRendering == false) {
        framenum++;

        if (head_msg == 'Tilted to side') {
          hmtcount = hmtcount + 1;
        }
        else if (head_msg == 'Straight') {
          hmscount = hmscount + 1;
        }

        if (earmsg == 'Straight') {
          emscount = emscount + 1;
        }
        else if (earmsg == 'Left') {
          emlcount = emlcount + 1;
        }
        else if (earmsg == 'Right') {
          emrcount = emrcount + 1;
        }
        else if (earmsg == 'Lowered') {
          emlowcount = emlowcount + 1;
        }

        if (brightmsg == 'Good') {
          bmgcount = bmgcount + 1;
        }
        else if (brightmsg == 'Low') {
          bmlcount = bmlcount + 1;
        }

        if (emotmsg == 'Smiling') {
          emotscount = emotscount + 1;
        }
        else if (emotmsg == 'Not smiling') {
          emotnscount = emotnscount + 1;
        } else {
          emotncount = emotncount + 1;
        }
      }

      tl_x = keypoints[234][0];
      tl_y = keypoints[10][1];
      br_x = keypoints[454][0];
      br_y = keypoints[152][1];
      ww = br_x - tl_x;
      hh = br_y - tl_y;
      ctx.strokeStyle = ORANGE;

      ctx.beginPath();
      ctx.rect(tl_x, tl_y, ww, hh);
      ctx.lineWidth = 3;
      ctx.stroke();

      if (state.showFacemesh) {
        ctx.fillStyle = GREEN;

        for (let i = 0; i < NUM_KEYPOINTS; i++) {
          const x = keypoints[i][0];
          const y = keypoints[i][1];

          ctx.beginPath();
          ctx.arc(x, y, 1 /* radius */, 0, 2 * Math.PI);
          ctx.fill();
        }

        if (keypoints.length > NUM_KEYPOINTS) {
          ctx.strokeStyle = RED;
          ctx.lineWidth = 1;

          const leftCenter = keypoints[NUM_KEYPOINTS];
          const leftDiameterY = distance(
            keypoints[NUM_KEYPOINTS + 4], keypoints[NUM_KEYPOINTS + 2]);
          const leftDiameterX = distance(
            keypoints[NUM_KEYPOINTS + 3], keypoints[NUM_KEYPOINTS + 1]);

          ctx.beginPath();
          ctx.ellipse(
            leftCenter[0], leftCenter[1], leftDiameterX / 2, leftDiameterY / 2,
            0, 0, 2 * Math.PI);
          ctx.stroke();

          if (keypoints.length > NUM_KEYPOINTS + NUM_IRIS_KEYPOINTS) {
            const rightCenter = keypoints[NUM_KEYPOINTS + NUM_IRIS_KEYPOINTS];
            const rightDiameterY = distance(
              keypoints[NUM_KEYPOINTS + NUM_IRIS_KEYPOINTS + 2],
              keypoints[NUM_KEYPOINTS + NUM_IRIS_KEYPOINTS + 4]);
            const rightDiameterX = distance(
              keypoints[NUM_KEYPOINTS + NUM_IRIS_KEYPOINTS + 3],
              keypoints[NUM_KEYPOINTS + NUM_IRIS_KEYPOINTS + 1]);

            ctx.beginPath();
            ctx.ellipse(
              rightCenter[0], rightCenter[1], rightDiameterX / 2,
              rightDiameterY / 2, 0, 0, 2 * Math.PI);
            ctx.stroke();
          }
        }
      }

    });
  }

  else {
    ctx.font = "20px Arial bold";
    ctx.fillStyle = RED;
    ctx.fillText('Failed to detect, please adjust lighting and position', 30, 475);
  }

  stats.end();
  rafID = requestAnimationFrame(renderPrediction);
};

async function render_canvas() {

  videoWidth = video.videoWidth;
  videoHeight = video.videoHeight;
  video.width = videoWidth;
  video.height = videoHeight;

  canvas = document.getElementById('output');
  canvas.width = videoWidth;
  canvas.height = videoHeight;
  const canvasContainer = document.querySelector('.canvas-wrapper');
  canvasContainer.style = `width: ${videoWidth}px; height: ${videoHeight}px`;

  ctx = canvas.getContext('2d');
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.fillStyle = GREEN;
  ctx.strokeStyle = GREEN;
  ctx.lineWidth = 0.5;
  canvas.hidden = true;

  canvas2 = document.getElementById('raw_output');
  canvas2.width = videoWidth;
  canvas2.height = videoHeight;
  ctx2 = canvas2.getContext('2d');
  ctx2.translate(canvas2.width, 0);
  ctx2.scale(-1, 1);
  ctx2.fillStyle = GREEN;
  ctx2.strokeStyle = GREEN;
  ctx2.lineWidth = 0.5;
  canvas2.hidden = true;

  video.play();
  setTimeout(function () {
    canvas2.hidden = false;
  }, 1000);
}

function once(subject) {
  var first = true;
  return function () {
    if (first) {
      first = false;
      return setupDatGui();
    } else {
      return null;
    }
  };
}

var wrapper = once(function () { alert("No more!"); });

async function main() {
  //Check if button has class 'disabled' and then do your function. 
  if (!$('#record-button').hasClass('disabled')) {
    $('#record-button').addClass('disabled');
    initrecord();
  }
}

async function initrecord() {
  await tf.setBackend(state.backend);
  wrapper();

  stats.showPanel(0);  // 0: fps, 1: ms, 2: mb, 3+: custom

  model = await faceLandmarksDetection.load(
    faceLandmarksDetection.SupportedPackages.mediapipeFacemesh,
  );
  //Promise.all([
  //  faceapi.nets.tinyFaceDetector.loadFromUri('/static/models'),
  // faceapi.nets.faceLandmark68Net.loadFromUri('/static/models'),
  //  faceapi.nets.faceExpressionNet.loadFromUri('/static/models')
  // ]).then()

  await setupCamera();
  await render_canvas();
  renderPrediction();
  toggleRecording();
  $('#record-button').removeClass('disabled');
};

'use strict';

function generateID() {
  // Math.random should be unique because of its seeding algorithm.
  // Convert it to base 36 (numbers + letters), and grab the first 9 characters
  // after the decimal.
  var id = "v-6dc721b8-2f1b-4c39-9279-85feb7e92472_mp4"
  id = 'v-' + Math.random().toString(36).substr(2, 9) + '-' + Math.random().toString(36).substr(2, 5) + '-' + Math.random().toString(36).substr(2, 5) + '-' + Math.random().toString(36).substr(2, 5) + '-' + Math.random().toString(36).substr(2, 13);
  return id;
};
var ID = generateID();

// This code is adapted from
// https://rawgit.com/Miguelao/demos/master/mediarecorder.html

var mediaSource = new MediaSource();
mediaSource.addEventListener('sourceopen', handleSourceOpen, false);
var mediaRecorder;
var recordedBlobs;
var sourceBuffer;
canvas = document.getElementById('output');
canvas2 = document.getElementById('raw_output');
let recordedVideo = document.querySelector('video#recorded');
let recordedCanvas = document.querySelector('canvas#recorded_output');
var ctxRec = recordedCanvas.getContext('2d');
recordedCanvas.width = 500;
recordedCanvas.height = 500;
recordedCanvas.offsetTop = canvas.offsetTop;
recordedCanvas.offsetLeft = canvas.offsetLeft;

var recordButton = document.getElementById('record-button')
var playButton = document.querySelector('button#review-button');
var downloadButton = document.querySelector('button#accept-button');
var rejectButton = document.querySelector('button#reject-button');

playButton.onclick = play;
downloadButton.onclick = download;
rejectButton.onclick = rejectVideo;

//Recorded video
recordedVideo.addEventListener('play', function () {

  var t = recordedVideo;
  (function loop() {
    if (!t.paused && !t.ended) {
      ctxRec.drawImage(t, 0, 0);
      setTimeout(loop, 1000 / 15); // drawing at 30fps
    }
  })();
}, 0);

console.log('location.host:', location.host);
// window.isSecureContext could be used for Chrome
var isSecureOrigin = location.protocol === 'https:' ||
  location.host.includes('localhost');
if (!isSecureOrigin) {
  alert('getUserMedia() must be run from a secure origin: HTTPS or localhost.' +
    '\n\nChanging protocol to HTTPS');
  location.protocol = 'HTTPS';
}

function handleSourceOpen(event) {
  console.log('MediaSource opened');
  sourceBuffer = mediaSource.addSourceBuffer('video/webm; codecs="vp8"');
  console.log('Source buffer: ', sourceBuffer);
}

function handleDataAvailable(event) {
  if (event.data && event.data.size > 0) {
    recordedBlobs.push(event.data);
  }
}

var countdown;
var countdown_number;

function displayAnimation() {
  countdown_number = 6;
  countdown_trigger();
}

function countdown_trigger() {
  countdown_number--;
  if (countdown_number > 0) {
    span = document.getElementById("counter");
    span.innerHTML = countdown_number;
    if (countdown_number > 0) {
      countdown = setTimeout('countdown_trigger()', 1000);
    }
  }
}

function handleStop(event) {
  console.log('Recorder stopped: ', event);
  console.log('Recorded Blobs: ', recordedBlobs);
}

function singleclick() {
  recordButton.onclick = "";
}

var record_msg = document.getElementById("recrd_in");
var stop_recmsg = document.getElementById("stop_rec");
var choose = document.getElementById("choose_rec");
var upload_icon = document.getElementById("upload-button");

function toggleRecording() {
  gui.domElement.style.visibility = "visible";
  canvas2.style.visibility = 'visible';
  canvas.style.visibility = 'visible';
  document.getElementById("counter").style.display = "block";
  displayAnimation();
  record_msg.hidden = false;
  stop_recmsg.hidden = true;
  choose.style.display = "none";
  recordButton.style.display = "none";
  upload_icon.style.display = "none";
  singleclick();
  setTimeout(function () {
    document.getElementById("counter").style.display = "none";
    record_msg.hidden = true;
    stop_recmsg.hidden = false;
    startRecording();
  }, 6000);
}

function startRecording() {
  hmtcount = hmscount = emscount = emlowcount = emlcount = emrcount = bmgcount = bmlcount = emotscount = emotncount = emotnscount = 0;
  framenum = 0;
  stopRendering = false;
  var options = {
    audioBitsPerSecond: 69000,
    videoBitsPerSecond: 292000,
    mimeType: 'video/webm;codecs=vp9'
  }
  //var options = {mimeType: 'video/webm;codecs=vp9', bitsPerSecond: 100000};
  recordedBlobs = [];
  try {
    const stream2 = canvas.captureStream()

    var audioTrack = stream.getTracks().filter(function (track) {
      return track.kind === 'audio'
    })[0];
    stream2.addTrack(audioTrack);

    mediaRecorder = new MediaRecorder(stream2, options);
  } catch (e0) {
    console.log('Unable to create MediaRecorder with options Object: ', options, e0);
    try {

      options = { mimeType: 'video/webm;codecs=vp8', bitsPerSecond: 100000 };
      mediaRecorder = new MediaRecorder(stream2, options);
    } catch (e1) {
      console.log('Unable to create MediaRecorder with options Object: ', options, e1);
      try {
        mediaRecorder = new MediaRecorder(stream2);
      } catch (e2) {
        alert('MediaRecorder is not supported by this browser.');
        console.log('Unable to create MediaRecorder', e2);
        return;
      }
    }
  }
  console.log('Created MediaRecorder', mediaRecorder, 'with options', options);
  playButton.disabled = true;
  downloadButton.disabled = true;
  mediaRecorder.onstop = handleStop;
  mediaRecorder.ondataavailable = handleDataAvailable;
  mediaRecorder.start(10); // collect 10ms of data
  console.log('MediaRecorder started', mediaRecorder);
}

function stopRecording() {
  mediaRecorder.stop();
  playButton.disabled = false;
  stopRendering = true;
  recordedVideo.controls = true;
  stop_recmsg.hidden = true;
  playButton.style.display = "inline";
  downloadButton.style.display = "inline";
  rejectButton.style.display = "inline";
}

function play() {
  review = true;
  console.log('Clicked play button');
  recordButton.disabled = true;
  downloadButton.disabled = false;
  rejectButton.disabled = false;
  video.pause();

  var type = (recordedBlobs[0] || {}).type;
  var superBuffer = new Blob(recordedBlobs, { type });
  recordedVideo.src = window.URL.createObjectURL(superBuffer);
  canvas.hidden = true;
  canvas2.hidden = true;
  console.log('Before starting video');
  recordedCanvas.hidden = false;
  recordedCanvas.width = 500;
  recordedCanvas.height = 500;
  recordedVideo.play();
  console.log('After starting video');
}

function download() {
  var eye_attention_metric = { "total": framenum, "lowered": emlowcount, "straight": emscount, "left": emlcount, "right": emrcount };
  var head_position_metric = { "total": framenum, "tilted to side": hmtcount, "straight": hmscount };
  var emotion_metric = { "total": framenum, "smiling": emotscount, "neutral": emotncount, "not smiling": emotnscount };
  var brightness_metric = { "total": framenum, "good": bmgcount, "low": bmlcount };
  var metrics = {
    "api_version": "0.1",
    "metrics": {
      "expression": [
      ],
      "head_orientation": 0.0,
      "head_pose": 0.0,
      "head_orientation_v0.2": head_position_metric,
      "head_pose_v0.2": eye_attention_metric,
      "emotion_v0.2": emotion_metric,
      "brightness": brightness_metric,
      "length": "1763059.3333333333",
      "length_silence": "17786",
      "percent_silence": "0.29659151547491996",
      "short_pause_count": "15",
      "short_pause_tot_duration": "2209",
      "med_pause_count": "19",
      "med_pause_tot_duration": "8627",
      "long_pause_count": "5",
      "long_pause_tot_duration": "6950",
      "voiced_ratio": "0.7030333333333333",
      "fwrd_counts": "{'just': 1, 'very': 1}",
      "transcript_length": "123",
      "fwrd_rate": "1.63",
      "transcript_json": "{}",
      "transcript_text": "Hello",
      "word_rate": "123.06562569835992"
    }
  }
  var res_json = metrics;
  console.log(JSON.stringify(res_json));
  uploadVfsScore(JSON.stringify(res_json), 'res.json');
  recordedVideo.style = { visibility: "hidden" };
  var blob = new Blob(recordedBlobs, { type: 'video/webm' });
  var url = window.URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = ID + '.webm';
  document.body.appendChild(a);
  a.click();
  setTimeout(function () {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 100);
  video.play();
  review = false;

  canvas.style.visibility = "hidden";
  canvas2.style.visibility = "hidden";

  recordedCanvas.hidden = true;
  downloadButton.disabled = true;
  rejectButton.disabled = true;
  recordButton.disabled = false;
  recordButton.style.display = "inline";
  upload_icon.style.display = "inline";
  playButton.disabled = true;
  recordedVideo.pause();
  playButton.style.display = "none";
  downloadButton.style.display = "none";
  rejectButton.style.display = "none";
  choose.style.display = "inline";

  gui.domElement.style.visibility = "hidden";
}

function rejectVideo() {
  recordButton.style.display = "none";
  recordedVideo.style = { visibility: "hidden" };
  recordButton.disabled = false;
  toggleRecording();
  video.play();
  review = false;

  if (state.showMetrics) {
    canvas.hidden = false;
    canvas2.hidden = true;
  }
  else {
    canvas.hidden = true;
    canvas2.hidden = false;
  }
  recordedCanvas.hidden = true;
  downloadButton.disabled = true;
  rejectButton.disabled = true;
  playButton.disabled = true;
  recordedVideo.pause();
  singleclick();
  playButton.style.display = "none";
  downloadButton.style.display = "none";
  rejectButton.style.display = "none";
}

function upload() {
  var blob = new Blob(recordedBlobs, { type: 'video/webm' });
  var url = window.URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = ID() + '.webm';
  document.body.appendChild(a);
  a.click();
  setTimeout(function () {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 100);
}

function njArray() {
  var a = nj.array([2, 3, 4]);
  return a;
}

function test() {
  a = njArray();
  b = math.norm()
  console.log(a.shape);
}