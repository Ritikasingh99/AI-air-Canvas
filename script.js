const videoElement = document.getElementById("video");
const canvasElement = document.getElementById("canvas");
const ctx = canvasElement.getContext("2d");

// Resize canvas
function resizeCanvas() {
  canvasElement.width = window.innerWidth;
  canvasElement.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

// Persistent drawing layer
const drawingCanvas = document.createElement("canvas");
const drawingCtx = drawingCanvas.getContext("2d");

function resizeDrawingCanvas() {
  drawingCanvas.width = window.innerWidth;
  drawingCanvas.height = window.innerHeight;
}
resizeDrawingCanvas();
window.addEventListener("resize", resizeDrawingCanvas);

let prevX = null;
let prevY = null;
let brushColor = "#00ffff";
let brushSize = 5;
let eraserSize = 20;
let prevDynamicEraser = eraserSize; // smoothing for depth-based eraser
let isEraser = false;

// ================= Toolbar Controls =================

// Color selection
const colorButtons = document.querySelectorAll(".color");

colorButtons.forEach(button => {
  button.addEventListener("click", () => {
    brushColor = button.getAttribute("data-color");
    isEraser = false;
    document.getElementById("eraserBtn").classList.remove("active");
    if (eraserIndicator) eraserIndicator.classList.remove('active');

    colorButtons.forEach(b => b.style.outline = "none");
    button.style.outline = "3px solid white";
  });
});

// Brush size slider
const brushSlider = document.getElementById("brushSize");
brushSlider.addEventListener("input", (e) => {
  brushSize = e.target.value;
});

// Eraser indicator (no slider) — visual only; circle scales with eraser size
const eraserIndicator = document.getElementById("eraserIndicator");
function updateEraserIndicator(size) {
  if (!eraserIndicator) return;
  const MAX_DISPLAY = 64; // max px shown in toolbar
  const dia = Math.max(6, Math.min(MAX_DISPLAY, Math.round(size)));
  eraserIndicator.style.width = dia + "px";
  eraserIndicator.style.height = dia + "px";
  eraserIndicator.style.borderWidth = Math.max(1, Math.round(dia / 12)) + "px";
}
updateEraserIndicator(eraserSize);

// helper: draw shape (used for preview + commit)
function drawShapePreview(ctxRef, shape, x1, y1, x2, y2) {
  if (!shape || x1 == null || y1 == null || x2 == null || y2 == null) return;

  switch (shape) {
    case 'line':
      ctxRef.beginPath();
      ctxRef.moveTo(x1, y1);
      ctxRef.lineTo(x2, y2);
      ctxRef.stroke();
      break;

    case 'rectangle': {
      const rx = Math.min(x1, x2);
      const ry = Math.min(y1, y2);
      const rw = Math.abs(x2 - x1);
      const rh = Math.abs(y2 - y1);
      ctxRef.strokeRect(rx, ry, rw, rh);
      break;
    }

    case 'square': {
      const w = Math.abs(x2 - x1);
      const h = Math.abs(y2 - y1);
      const size = Math.max(w, h);
      const sx = x2 >= x1 ? x1 : x1 - size;
      const sy = y2 >= y1 ? y1 : y1 - size;
      ctxRef.strokeRect(sx, sy, size, size);
      break;
    }

    case 'circle': {
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const rx = Math.abs(x2 - x1) / 2;
      const ry = Math.abs(y2 - y1) / 2;
      const r = Math.max(rx, ry);
      ctxRef.beginPath();
      ctxRef.arc(cx, cy, r, 0, Math.PI * 2);
      ctxRef.stroke();
      break;
    }

    case 'oval': {
      // draw an ellipse fitting the bounding box defined by (x1,y1)-(x2,y2)
      const cx_o = (x1 + x2) / 2;
      const cy_o = (y1 + y2) / 2;
      const rx_o = Math.abs(x2 - x1) / 2;
      const ry_o = Math.abs(y2 - y1) / 2;
      ctxRef.beginPath();
      if (ctxRef.ellipse) {
        ctxRef.ellipse(cx_o, cy_o, rx_o, ry_o, 0, 0, Math.PI * 2);
      } else {
        // fallback: approximate with arc using max radius
        ctxRef.arc(cx_o, cy_o, Math.max(rx_o, ry_o), 0, Math.PI * 2);
      }
      ctxRef.stroke();
      break;
    }

    default:
      // fallback to a short line
      ctxRef.beginPath();
      ctxRef.moveTo(x1, y1);
      ctxRef.lineTo(x2, y2);
      ctxRef.stroke();
  }
}

// Eraser button
const eraserBtn = document.getElementById("eraserBtn");
eraserBtn.addEventListener("click", () => {
  isEraser = !isEraser;

  if (isEraser) {
    eraserBtn.classList.add("active");
    if (eraserIndicator) eraserIndicator.classList.add('active');
  } else {
    eraserBtn.classList.remove("active");
    if (eraserIndicator) eraserIndicator.classList.remove('active');
  }
});

// Shape tools
let currentShape = 'free';
let shapeStartX = null;
let shapeStartY = null;
let isDrawingShape = false;
let prevPinch = false;

const shapeButtons = document.querySelectorAll('.shape-btn');
shapeButtons.forEach(b => {
  b.addEventListener('click', () => {
    shapeButtons.forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    currentShape = b.getAttribute('data-shape');
    // cancel any in-progress shape
    isDrawingShape = false;
    shapeStartX = shapeStartY = null;
  });
});

// ====================================================

// Initialize MediaPipe
const hands = new Hands({
  locateFile: (file) =>
    `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

hands.onResults((results) => {
  ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  ctx.drawImage(drawingCanvas, 0, 0);

  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    prevX = null;
    prevY = null;
    return;
  }

  const landmarks = results.multiHandLandmarks[0];

  const indexTip = landmarks[8];
  const thumbTip = landmarks[4];
  const middleTip = landmarks[12];

  const x = indexTip.x * canvasElement.width;
  const y = indexTip.y * canvasElement.height;

  const thumbX = thumbTip.x * canvasElement.width;
  const thumbY = thumbTip.y * canvasElement.height;

  const middleX = middleTip.x * canvasElement.width;
  const middleY = middleTip.y * canvasElement.height;

  // Red debug dot (index finger)
  ctx.beginPath();
  ctx.arc(x, y, 8, 0, 2 * Math.PI);
  ctx.fillStyle = "red";
  ctx.fill();

  // Gesture detection: thumb+index = draw, index+middle = erase (depth-sensitive)
  const pinchDistance = Math.hypot(x - thumbX, y - thumbY);
  const indexMiddleDistance = Math.hypot(x - middleX, y - middleY);

  const DRAW_THRESHOLD = 60;
  const ERASE_THRESHOLD = 60;

  const isPinching = pinchDistance < DRAW_THRESHOLD;
  const isIndexMiddleTouch = indexMiddleDistance < ERASE_THRESHOLD;

  // compute a depth-based eraser size when index+middle gesture is active
  let effectiveEraserSize = eraserSize;
  if (isIndexMiddleTouch) {
    const avgZ = (indexTip.z + middleTip.z) / 2;
    const DEPTH_MIN = -0.6;
    const DEPTH_MAX = 0.2;
    let depthNorm = (avgZ - DEPTH_MIN) / (DEPTH_MAX - DEPTH_MIN);
    depthNorm = Math.max(0, Math.min(1, depthNorm));
    const MIN_ERASE = 5;
    const dynamic = Math.round(MIN_ERASE + depthNorm * (eraserSize - MIN_ERASE));
    prevDynamicEraser = prevDynamicEraser * 0.85 + dynamic * 0.15;
    effectiveEraserSize = Math.max(MIN_ERASE, Math.min(eraserSize, Math.round(prevDynamicEraser)));
    if (eraserIndicator) updateEraserIndicator(effectiveEraserSize);
  } else {
    if (eraserIndicator) updateEraserIndicator(eraserSize);
  }

  // --- ERASER GESTURE (index + middle) : always active when that gesture is present ---
  if (isIndexMiddleTouch) {
    // cancel any pending shape
    isDrawingShape = false;
    shapeStartX = shapeStartY = null;

    // erase continuously like before
    if (prevX !== null && prevY !== null) {
      drawingCtx.beginPath();
      drawingCtx.moveTo(prevX, prevY);
      drawingCtx.lineTo(x, y);
      drawingCtx.globalCompositeOperation = "destination-out";
      drawingCtx.lineWidth = effectiveEraserSize;
      drawingCtx.lineCap = "round";
      drawingCtx.stroke();
    }

    eraserBtn.classList.add("active");
    if (eraserIndicator) eraserIndicator.classList.add('active');
    prevX = x;
    prevY = y;

  } else {
    // Not erasing — handle drawing according to selected shape

    eraserBtn.classList.remove("active");
    if (eraserIndicator) eraserIndicator.classList.remove('active');

    if (currentShape === 'free') {
      // freehand brush (thumb+index pinch)
      if (isPinching) {
        if (prevX !== null && prevY !== null) {
          drawingCtx.beginPath();
          drawingCtx.moveTo(prevX, prevY);
          drawingCtx.lineTo(x, y);
          drawingCtx.globalCompositeOperation = "source-over";
          drawingCtx.strokeStyle = brushColor;
          drawingCtx.lineWidth = brushSize;
          drawingCtx.lineCap = "round";
          drawingCtx.stroke();
        }
        prevX = x;
        prevY = y;
      } else {
        prevX = null;
        prevY = null;
      }

      // cancel any in-progress shape preview
      isDrawingShape = false;
      shapeStartX = shapeStartY = null;

    } else {
      // Shape drawing modes (line, rectangle, square, circle)
      // start: pinch goes from false->true
      if (isPinching && !prevPinch) {
        shapeStartX = x;
        shapeStartY = y;
        isDrawingShape = true;
      }

      // preview while pinching
      if (isPinching && isDrawingShape) {
        // draw preview on top (ctx) without committing
        ctx.save();
        ctx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
        ctx.strokeStyle = brushColor;
        ctx.lineWidth = brushSize;
        ctx.lineCap = 'round';

        drawShapePreview(ctx, currentShape, shapeStartX, shapeStartY, x, y);
        ctx.restore();
      }

      // commit when pinch released
      if (!isPinching && prevPinch && isDrawingShape) {
        drawingCtx.save();
        drawingCtx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
        drawingCtx.strokeStyle = brushColor;
        drawingCtx.lineWidth = brushSize;
        drawingCtx.lineCap = 'round';

        drawShapePreview(drawingCtx, currentShape, shapeStartX, shapeStartY, x, y);

        drawingCtx.restore();

        isDrawingShape = false;
        shapeStartX = shapeStartY = null;
      }

      // while drawing shapes we don't do freehand strokes
      prevX = null;
      prevY = null;
    }
  }

  // update pinch state for next frame
  prevPinch = isPinching;
});

// Start camera
const camera = new Camera(videoElement, {
  onFrame: async () => {
    await hands.send({ image: videoElement });
  },
  width: 640,
  height: 480
});

camera.start();
