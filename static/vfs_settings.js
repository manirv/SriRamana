
const NUM_KEYPOINTS = 468;
const NUM_IRIS_KEYPOINTS = 5;
const GREEN = '#32EEDB';
const RED = '#FF2C35';
const BLUE = '#157AB3';
const ORANGE = '#eb9748';
let stopRendering = false;

function isMobile() {
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isiOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  return isAndroid || isiOS;
}

function distance(a, b) {
  return Math.sqrt(Math.pow(a[0] - b[0], 2) + Math.pow(a[1] - b[1], 2));
}

let model, ctx, videoWidth, videoHeight, video, canvas,
  scatterGLHasInitialized = false, scatterGL, rafID;

const VIDEO_SIZE = 500;
const mobile = isMobile();
const renderPointcloud = mobile === false;
const stats = new Stats();
const state = {
  backend: mobile ? 'wasm' : 'webgl',
  showFacemesh: false,
  showIrises: false
};

async function setupCamera() {
  video = document.getElementById('video');

  const stream = await navigator.mediaDevices.getUserMedia({
    'audio': false,
    'video': {
      facingMode: 'user',
      // Only setting the video to a specified size in order to accommodate a
      // point cloud, so on mobile devices accept the default size.
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
var canvas2 = document.getElementById('position');
var canvas3 = document.getElementById('brightness');
var canvas4 = document.getElementById('smile');

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

async function renderPrediction() {
  if (stopRendering) {
    return;
  }

  stats.begin();
  const predict_iris = true;
  const predictions = await model.estimateFaces({
    input: video,
    returnTensors: false,
    flipHorizontal: false,
    showIrises: predict_iris
  });
  total_height = video.videoHeight;
  total_width = video.videoWidth;

  text_left = total_width * 1 / 10
  text_top = total_height * 9 / 10
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  //ctx.scale(-1, 1);
  ctx.drawImage(
    video, 0, 0, videoWidth, videoHeight, 0, 0, canvas.width, canvas.height);
  //ctx.restore();

  //Get Brightness of the video frame
  var colorSum = 0;
  var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  var data = imageData.data;
  var r, g, b, avg;

  for (var x = 0, len = data.length; x < len; x += 4) {
    r = data[x];
    g = data[x + 1];
    b = data[x + 2];

    avg = Math.floor((r + g + b) / 3);
    colorSum += avg;
  }

  var brightness = Math.floor(colorSum / (video.width * video.height));
  if (brightness < 90) {
    counter = 0;
    canvas3.style.display = "block";

    document.getElementById("counter").style.display = "none";
    canvas4.style.display = "none";

    msg = "It's too dark. Please adjust your lighting";
    var con = canvas3.getContext("2d");
    con.fillStyle = "red";
    con.fillRect(0, 0, 500, 40);
    con.fillStyle = "white";
    con.font = "15pt sans-serif";
    con.fillText(msg, 10, 25);
  }
  else {
    canvas3.style.display = "none";

  }

  if (predictions.length == 0) {
    msg = "No face detected";
    var con = canvas2.getContext("2d");
    con.fillStyle = "red";
    con.fillRect(0, 0, 500, 40);
    con.fillStyle = "white";
    con.font = "15pt sans-serif";
    con.fillText(msg, 10, 25);
  }
  if (predictions.length > 0) {
    predictions.forEach(prediction => {
      const keypoints = prediction.scaledMesh;
      const bb = prediction.boundingBox;

      // console.log('Face in view confidence :: '+keypoints[454])
      x_point = keypoints[454][0];
      y_point = keypoints[454][1];
      z_point = keypoints[454][2];
      //console.log('depth ' + z_point);
      if ((x_point > 450 || x_point < 300) || (y_point < 150 || y_point > 300)) //&& (z_point>70 || z_point<60))
      {
        counter = 0;
        canvas2.style.display = "block";
        msg = "Please adjust your position in front of the camera";

        document.getElementById("counter").style.display = "none";
        canvas4.style.display = "none";

        var con = canvas2.getContext("2d");
        con.fillStyle = "red";
        con.fillRect(0, 0, 500, 40);
        con.fillStyle = "white";
        con.font = "15pt sans-serif";
        con.fillText(msg, 10, 25);

      }
      else {
        if (document.getElementById("record-button").style.display == "none") {
          counter++;
          canvas2.style.display = "none";
          canvas3.style.display = "none";

          if (counter == 50) {
            displayAnimation();
            document.getElementById("counter").style.display = "block";
            canvas4.style.display = "block";
            msg = "Say Cheese";
            var con = canvas4.getContext("2d");
            con.fillStyle = "green";
            con.fillRect(0, 0, 500, 40);
            con.fillStyle = "white";
            con.font = "15pt sans-serif";
            con.fillText(msg, 200 , 25);
          }

          if (counter == 175) {
            let click_button = document.querySelector("#record-button");
            click_button.style.display = "inline";
            click_button.onclick = e => {
              takeASnap()
              .then(download);
            };
          }
        }

        else {
          document.getElementById("counter").style.display = "none";
          canvas2.style.display = "none";
          canvas3.style.display = "none";
          canvas4.style.display = "block";
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

    });

  }

  stats.end();
  rafID = requestAnimationFrame(renderPrediction);
};

function takeASnap(){
  const canvas = document.createElement('canvas'); // create a canvas
  const ctx = canvas.getContext('2d'); // get its context
  canvas.width = video.videoWidth; // set its size to the one of the video
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0,0); // the video
  return new Promise((res, rej)=>{
    canvas.toBlob(res, 'image/jpeg'); // request a Blob from the canvas
  });
}
function download(blob){
  // uses the <a download> to download a Blob
  let a = document.createElement('a'); 
  a.href = URL.createObjectURL(blob);
  a.download = 'photo.jpg';
  document.body.appendChild(a);
  a.click();
}

async function main() {
  await tf.setBackend(state.backend);
  stats.showPanel(0);  // 0: fps, 1: ms, 2: mb, 3+: custom
  //document.getElementById('main').appendChild(stats.dom);

  await setupCamera();
  video.play();
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

  model = await faceLandmarksDetection.load(
    faceLandmarksDetection.SupportedPackages.mediapipeFacemesh,
    // {maxFaces: state.maxFaces}
  );
  renderPrediction();

};

main();
