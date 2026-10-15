import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appSettings} from '../app/settings.js';

test('legacy App preferences migrate without copying CLI connection fields',()=>{
  assert.deepEqual(appSettings({serverUrl:'https://old.example',deviceName:'Old device',paused:true,language:'en',trayMetric:'cost'}),{trayMetric:'cost',language:'en'});
});
test('popup preferences preserve a usable, independent layout',()=>{
  const source={trayRange:30,trayTheme:'dark',trayWidgets:['models','activity','models']};
  const saved=appSettings(source);
  assert.deepEqual(saved,{trayRange:30,trayTheme:'dark',trayWidgets:['models','activity']});
  source.trayWidgets.push('overview');assert.deepEqual(saved.trayWidgets,['models','activity']);
  assert.deepEqual(appSettings({trayRange:90,trayTheme:'invalid',trayWidgets:[]}),{});
});

test('widget migration keeps the visual order and all catalog widgets',()=>{
  assert.deepEqual(appSettings({trayWidgets:['output','composition','devices','cache','activity','models','trend','overview','output','unknown']}),{trayWidgets:['output','composition','devices','cache','activity','models','trend','overview']});
});
