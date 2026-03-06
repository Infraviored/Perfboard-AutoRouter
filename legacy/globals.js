
// globals.js — Shared global state for the autorouter
var COLS = 22, ROWS = 16, SP = 28;
var zoom = 1, panX = 0, panY = 0;
var panning = false, panStart = null;
var tool = 'sel';
var components = [];
var compDefs = [];
var wires = [];
var selComp = null;
var dragging = null, dragOff = null;
var hovNet = null;
var toastTid = null;
var gCancelRequested = false;
var gCancelOp = null;
var editingComp = null;

// window.packerConfig is already defined in app.js or index.html
