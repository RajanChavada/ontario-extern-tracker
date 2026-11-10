// Flags rendered slides whose content leaves the safe area. Run after render.mjs.
import puppeteer from 'puppeteer-core';
import { readdirSync } from 'node:fs';
const B=new URL('./out/', import.meta.url).pathname;
const br=await puppeteer.launch({executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const pg=await br.newPage(); const bad=[];
for (const post of readdirSync(B).filter(d=>!d.startsWith('_')&&!d.includes('.'))) for (const [fmt,w,h] of [['ig',1080,1350],['tt',1080,1920]]) {
  await pg.setViewport({width:w,height:h});
  for (const f of readdirSync(B+post+'/'+fmt).filter(f=>f.endsWith('.html'))) {
    await pg.goto('file://'+B+post+'/'+fmt+'/'+f,{waitUntil:'load'}); await new Promise(r=>setTimeout(r,300));
    if (await pg.$('.overflow-flag')) bad.push(post+'/'+fmt+'/'+f);
  }}
console.log('slides with content outside the safe area:', bad.length?bad:'none'); await br.close();
