import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trayAnchor, trayPopupBounds } from '../app/tray-placement.js';

test('a click on a secondary menu bar overrides icon bounds from the primary display', () => {
  const primaryIcon = {x:1400,y:0,width:60,height:24};
  const leftDisplay = {x:-1920,y:-120,width:1920,height:1080};
  const click = {x:-80,y:-108};
  const anchor = trayAnchor(primaryIcon, click, leftDisplay);
  assert.deepEqual(anchor, {...click,width:0,height:0});
  const area = {...leftDisplay,y:-96,height:1056};
  const initial = trayPopupBounds(anchor, area, 640);
  const resized = trayPopupBounds(anchor, area, 740);
  assert.deepEqual(initial, {x:-420,y:-96,width:420,height:640});
  assert.deepEqual(resized, {...initial,height:740});
});

test('popup stays within the clicked display, including taskbars and small screens', () => {
  const icon = {x:1100,y:770,width:24,height:30};
  const display = {x:0,y:0,width:1200,height:800};
  assert.deepEqual(trayAnchor({x:0,y:0,width:0,height:0},{x:1110,y:12},display),{x:1110,y:12,width:0,height:0});
  assert.deepEqual(trayAnchor(icon,{x:1110,y:785},display),icon);
  assert.deepEqual(trayPopupBounds(icon,{x:0,y:0,width:1200,height:770},900), {x:780,y:12,width:420,height:752});
  assert.deepEqual(trayPopupBounds({x:300,y:0,width:24,height:24},{x:0,y:24,width:360,height:240},700),{x:0,y:30,width:360,height:222});
});
