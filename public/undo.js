/* Undo / redo for editor.html (one cell) and trace.html (the whole outline).

   The page says how to take a snapshot of what can be undone and how to put
   one back, and calls checkpoint() just before every change:

       const History = new UndoHistory(take, put, onChange);
       History.checkpoint();          // before a change
       History.undo(); History.redo();

   Snapshots are kept as JSON text, which also makes them independent copies.
   Ctrl+Z undoes, Ctrl+Y or Ctrl+Shift+Z redoes (Cmd on a Mac); bindKeys()
   attaches them, skipping text fields and anything busy() reports. */
(function(){
"use strict";

const LIMIT = 60;

function UndoHistory(take, put, onChange){
  this.take = take; this.put = put; this.onChange = onChange || function(){};
  this.past = []; this.future = [];
}
UndoHistory.prototype.now = function(){ return JSON.stringify(this.take()); };
UndoHistory.prototype.checkpoint = function(){
  const s = this.now();
  if(this.past[this.past.length - 1] !== s){
    this.past.push(s);
    if(this.past.length > LIMIT) this.past.shift();
  }
  this.future = [];
  this.onChange();
};
// step back (or forward) to the nearest snapshot that differs from what is on screen
UndoHistory.prototype.move = function(from, to){
  const cur = this.now();
  while(from.length && from[from.length - 1] === cur) from.pop();
  if(!from.length){ this.onChange(); return false; }
  to.push(cur);
  this.put(JSON.parse(from.pop()));
  this.onChange();
  return true;
};
UndoHistory.prototype.undo = function(){ return this.move(this.past, this.future); };
UndoHistory.prototype.redo = function(){ return this.move(this.future, this.past); };
UndoHistory.prototype.reset = function(){ this.past = []; this.future = []; this.onChange(); };
UndoHistory.prototype.canUndo = function(){ return this.past.length > 0; };
UndoHistory.prototype.canRedo = function(){ return this.future.length > 0; };

UndoHistory.prototype.bindKeys = function(busy, onUndo, onRedo){
  document.addEventListener('keydown', e => {
    if(!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable) return;
    const k = e.key.toLowerCase();
    const redo = k === 'y' || (k === 'z' && e.shiftKey);
    if(k !== 'z' && !redo) return;
    e.preventDefault();
    if(busy && busy()) return;
    if(redo) (onRedo || (() => this.redo()))();
    else (onUndo || (() => this.undo()))();
  });
};

window.UndoHistory = UndoHistory;
})();
