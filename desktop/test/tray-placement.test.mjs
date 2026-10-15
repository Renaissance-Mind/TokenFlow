import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trayAnchor, trayClickHandler, trayPopupBounds } from '../app/tray-placement.js';

test('native tray clicks capture the global cursor instead of macOS window-relative event coordinates', () => {
  const displays = [{x:0,y:0,width:1512,height:982},{x:-204,y:-1080,width:1920,height:1080}];
  let cursor = {x:1200,y:-1068};
  const openings = [];
  const click = trayClickHandler(() => cursor, (icon, point) => {
    const display = displays.find(d => point.x >= d.x && point.x < d.x + d.width && point.y >= d.y && point.y < d.y + d.height);
    const anchor = trayAnchor(icon,point,display);
    openings.push({point,display,anchor,bounds:trayPopupBounds(anchor,{...display,y:display.y+24,height:display.height-24},640)});
  });
  // Electron's native macOS callback flips the icon-local point (15, 12)
  // against the primary display height, yielding (15, 970) on either monitor.
  click({}, {x:1180,y:-1080,width:60,height:24}, {x:15,y:970});
  assert.deepEqual(openings[0].point,{x:1200,y:-1068});
  assert.equal(openings[0].display,displays[1]);
  assert.deepEqual(openings[0].bounds,{x:1000,y:-1050,width:420,height:640});
  cursor = {x:1300,y:12};
  click({}, {x:1280,y:0,width:60,height:24}, {x:15,y:970});
  assert.equal(openings[1].display,displays[0]);
  assert.deepEqual(openings[1].bounds,{x:1092,y:30,width:420,height:640});
  assert.deepEqual(openings[0].point,{x:1200,y:-1068});
});

test('stale icon bounds on the same display fall back to the real click position', () => {
  assert.deepEqual(trayAnchor({x:50,y:0,width:60,height:24},{x:1200,y:12},{x:0,y:0,width:1512,height:982}),{x:1200,y:12,width:0,height:0});
});

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
