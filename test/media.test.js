import test from 'node:test';
import assert from 'node:assert/strict';
import {dimensions} from '../src/dimensions.js';
import {parseMultipart} from '../src/multipart.js';
import {fileProperties,Store} from '../src/store.js';
import {svg,quiet,scratch} from './helpers.js';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write('IHDR',12);png.writeUInt32BE(321,16);png.writeUInt32BE(123,20);
const gif=Buffer.alloc(10);gif.write('GIF89a');gif.writeUInt16LE(321,6);gif.writeUInt16LE(123,8);
const jpeg=Buffer.from([0xff,0xd8,0xff,0xe0,0,4,0,0,0xff,0xc2,0,8,8,0,123,1,65,0]);
function webp(type,data){const out=Buffer.alloc(20+data.length+(data.length%2));out.write('RIFF');out.writeUInt32LE(out.length-8,4);out.write('WEBP',8);out.write(type,12);out.writeUInt32LE(data.length,16);data.copy(out,20);return out;}
const vp8=Buffer.alloc(10);Buffer.from([0x9d,1,0x2a]).copy(vp8,3);vp8.writeUInt16LE(321,6);vp8.writeUInt16LE(123,8);
const vp8l=Buffer.alloc(5);vp8l[0]=0x2f;vp8l.writeUInt32LE(320|(122<<14),1);
const vp8x=Buffer.alloc(10);vp8x.writeUIntLE(320,4,3);vp8x.writeUIntLE(122,7,3);
for(const[name,bytes]of[['PNG',png],['JPEG SOF',jpeg],['GIF',gif],['WebP VP8',webp('VP8 ',vp8)],['WebP VP8L',webp('VP8L',vp8l)],['WebP VP8X',webp('VP8X',vp8x)],['SVG dimensions',Buffer.from('<svg width="321px" height="123"/>')],['SVG viewBox',Buffer.from('<svg viewBox="0 0 321 123"/>')]])test('dimension detection: '+name,()=>assert.deepEqual(dimensions(bytes,name.startsWith('SVG')?'image/svg+xml':''),{width:321,height:123}));
test('SVG derives missing dimension from viewBox aspect ratio',()=>{assert.deepEqual(dimensions(Buffer.from('<svg width="100" viewBox="0 0 20 10"/>'),'image/svg+xml'),{width:100,height:50});assert.deepEqual(dimensions(Buffer.from('<svg height="100" viewBox="0 0 20 10"/>'),'image/svg+xml'),{width:200,height:100});});
test('malformed, zero, truncated and unknown dimensions are omitted',()=>{for(const bytes of[Buffer.alloc(0),Buffer.from('unknown'),png.subarray(0,20),jpeg.subarray(0,14),Buffer.from('<svg width="100%" height="50%"/>'),Buffer.from('<svg width="0" height="0"/>')])assert.deepEqual(dimensions(bytes,'image/svg+xml'),{});});
test('MIME and extension infer image, video or raw without filename traversal',()=>{assert.deepEqual(fileProperties({filename:'photo.JPEG'}),{mimeType:'image/jpeg',type:'image',ext:'jpeg'});assert.equal(fileProperties({filename:'clip.mp4'}).type,'video');assert.equal(fileProperties({filename:'binary'}).type,'raw_file');assert.equal(fileProperties({filename:'x',mimeType:'text/html\r\ninjected'}).mimeType,'application/octet-stream');});
function multipart(files,fields={}){const parts=[];const boundary='test-boundary';for(const[name,value]of Object.entries(fields))parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));for(const file of files)parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.filename}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`),file.data,Buffer.from('\r\n'));parts.push(Buffer.from(`--${boundary}--\r\n`));return Buffer.concat(parts);}
test('multipart single and multiple preserve bytes and ignore boundary substrings inside files',()=>{const files=[svg(),{filename:'binary.bin',mimeType:'application/octet-stream',data:Buffer.from([0,255,13,10,...Buffer.from('--test-boundaryNO'),1])}];const body=multipart(files,{csrf:'token',folderId:'folder'});const parsed=parseMultipart(body,'multipart/form-data; boundary="test-boundary"');assert.deepEqual({...parsed.fields},{csrf:'token',folderId:'folder'});assert.equal(parsed.files.length,2);assert.deepEqual(parsed.files.map(file=>file.data),files.map(file=>file.data));assert.equal(parseMultipart(multipart([svg()]),'multipart/form-data; boundary=test-boundary').files.length,1);});
test('multipart rejects invalid framing, oversized file and oversized fields',()=>{assert.throws(()=>parseMultipart(Buffer.alloc(0),'multipart/form-data'),/boundary/);assert.throws(()=>parseMultipart(multipart([svg()]).subarray(0,-40),'multipart/form-data; boundary=test-boundary'),/boundary/);assert.throws(()=>parseMultipart(multipart([svg()]),'multipart/form-data; boundary=test-boundary',{maxFileSize:10}),{status:413});assert.throws(()=>parseMultipart(multipart([],{field:'x'.repeat(65537)}),'multipart/form-data; boundary=test-boundary'),{status:413});});
test('store validates full upload before mutation and enforces 50 MB per file',()=>{const store=new Store({dataDir:':memory:',logger:quiet});assert.throws(()=>store.upload([svg(),{filename:'big.bin',data:Buffer.alloc(50*1024*1024+1)}]),{status:413});assert.equal(store.assets.length,0);assert.throws(()=>store.upload([]),/Choose/);assert.throws(()=>store.upload([{filename:'empty',data:Buffer.alloc(0)}]),/non-empty/);});

test('dimensions round fractional SVG sizes and derived aspect ratios to Graph integers',()=>{
 assert.deepEqual(dimensions(Buffer.from('<svg width="12.6" height="9.4"/>'),'image/svg+xml'),{width:13,height:9});
 assert.deepEqual(dimensions(Buffer.from('<svg width="2147483647.1" height="2147483647.49"/>'),'image/svg+xml'),{width:2147483647,height:2147483647});
 assert.deepEqual(dimensions(Buffer.from('<svg width="100" viewBox="0 0 3 1"/>'),'image/svg+xml'),{width:100,height:33});
 assert.deepEqual(dimensions(Buffer.from('<svg viewBox="0 0 0.5 2147483647"/>'),'image/svg+xml'),{width:1,height:2147483647});
});
test('dimensions omit nonpositive, rounded-zero and out-of-range sizes',()=>{
 for(const size of['0','-1','0.1','2147483648','2147483647.5','1e309'])assert.deepEqual(dimensions(Buffer.from(`<svg width="${size}" height="${size}"/>`),'image/svg+xml'),{});
 const large=Buffer.from(png);large.writeUInt32BE(0xffffffff,16);assert.deepEqual(dimensions(large),{height:123});
 assert.deepEqual(dimensions(Buffer.from('<svg viewBox="0 0 2147483648 0.1"/>'),'image/svg+xml'),{});
});
test('SVG detection requires SVG MIME rather than embedded markup',()=>{
 for(const mime of['','text/html','text/plain','image/png','application/pdf'])assert.deepEqual(dimensions(svg().data,mime),{});
 assert.deepEqual(dimensions(svg().data,'image/svg+xml'),{width:120,height:80});
});
test('upload and replacement only measure images and clear stale dimensions',()=>{
 const store=new Store({dataDir:':memory:',logger:quiet});
 const files=[{filename:'raw.bin',mimeType:'application/octet-stream',data:png},{filename:'page.html',mimeType:'text/html',data:svg().data},{filename:'clip.mp4',mimeType:'video/mp4',data:png},{filename:'clip.webm',mimeType:'video/webm',data:svg().data},{filename:'fake.png',mimeType:'image/png',data:svg().data}];
 for(const asset of store.upload(files)){assert.equal(asset.width,undefined);assert.equal(asset.height,undefined);}
 const [image]=store.upload([svg()]);assert.equal(image.width,120);
 for(const file of files){store.replace(image.id,svg());assert.equal(image.width,120);store.replace(image.id,file);assert.equal(image.width,undefined);assert.equal(image.height,undefined);}
});
test('multipart decodes quotes and strips percent-encoded CR/LF from filenames',()=>{
 const file={...svg(),filename:'folder/quoted%22name%0D%0a.svg'};
 const parsed=parseMultipart(multipart([file]),'multipart/form-data; boundary=test-boundary');
 assert.equal(parsed.files[0].filename,'quoted"name.svg');assert.deepEqual(parsed.files[0].data,file.data);
 assert.equal(parseMultipart(multipart([{...file,filename:'%0d%0A'}]),'multipart/form-data; boundary=test-boundary').files.length,0);
});
test('content hash metadata is persisted on upload/replacement and upgraded for old libraries',t=>{
 const root=scratch(t);const store=new Store({dataDir:root,logger:quiet});const [asset]=store.upload([svg()]);
 const hash=bytes=>'"'+createHash('sha256').update(bytes).digest('hex')+'"';
 assert.equal(asset.etag,hash(svg().data));const first=asset.etag;
 const replacement=svg('new bytes');store.replace(asset.id,replacement);assert.equal(asset.etag,hash(replacement.data));assert.notEqual(asset.etag,first);store.flush();
 const cached=new Store({dataDir:root,logger:quiet});assert.equal(cached.asset(asset.id).etag,asset.etag);
 const metadata=join(root,'assets.json');const state=JSON.parse(readFileSync(metadata));delete state.assets[0].etag;writeFileSync(metadata,JSON.stringify(state));
 const upgraded=new Store({dataDir:root,logger:quiet});assert.equal(upgraded.asset(asset.id).etag,asset.etag);upgraded.flush();assert.equal(JSON.parse(readFileSync(metadata)).assets[0].etag,asset.etag);
});
