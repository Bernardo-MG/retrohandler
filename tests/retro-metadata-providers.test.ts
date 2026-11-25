import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SqliteLibraryStore, type DatabaseHandle, type Statement } from '../src/main/database/library-store';
import { importLaunchBoxXml, parseLaunchBoxGame, xmlText } from '../src/main/metadata/launchbox';
import { findLibretroCover, libretroCandidates, libretroPlatform } from '../src/main/metadata/libretro';
import { getArtwork } from '../src/main/metadata/artwork';

function adapter(file: string): DatabaseHandle {
  const db = new DatabaseSync(file);
  return { pragma: sql => db.exec(`PRAGMA ${sql}`), exec: sql => db.exec(sql), prepare: sql => db.prepare(sql) as Statement,
    transaction: fn => () => { db.exec('BEGIN IMMEDIATE'); try { const result=fn();db.exec('COMMIT');return result; } catch(e) {db.exec('ROLLBACK');throw e;} }, close: () => db.close() };
}
const sample = (id: number, name: string, platform='Nintendo Entertainment System') => `<Game><DatabaseID>${id}</DatabaseID><Name>${name}</Name><Platform>${platform}</Platform><ReleaseDate>1992-03-01T00:00:00</ReleaseDate><Overview>Good &amp; old</Overview><Developer>Studio</Developer><Publisher>Publisher</Publisher><Genre>Action</Genre></Game>`;

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8FZgAAAABJRU5ErkJggg==','base64');

test('LaunchBox parses escaped game text and rejects missing platform', () => {
  assert.equal(xmlText('A &amp; B &#65; &lt;Test&gt;'), 'A & B A <Test>');
  const value = parseLaunchBoxGame(sample(17,'Sonic &amp; Knuckles'));
  assert.equal(value?.title, 'Sonic & Knuckles');
  assert.equal(value?.released,'1992-03-01');
  assert.equal(value?.description,'Good & old');
  assert.equal(parseLaunchBoxGame('<Game><DatabaseID>2</DatabaseID><Name>Empty</Name></Game>'),null);
});

test('LaunchBox import is searchable offline, persists and protects existing metadata', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(),'rh-launchbox-'));
  try {
    const file=path.join(dir,'Metadata.xml');
    await writeFile(file, '<LaunchBox>'+sample(17,'A &amp; B')+sample(18,'A &amp; Better','Super Nintendo Entertainment System')+'</LaunchBox>');
    const dbfile=path.join(dir,'library.sqlite');
    const store=new SqliteLibraryStore(dbfile,adapter);
    store.saveScan({source:'/games',scannedAt:'2026-01-01',ignored:0,games:[{id:'1',name:'Local game',system:'Nintendo Entertainment System',relativePath:'a.nes',extension:'.nes',bytes:1}]});
    store.saveMetadata('/games','a.nes',{title:'Manual title',description:'Custom',released:'1991',developer:'',publisher:'',genre:'',provider:'manual',providerId:null,providerSlug:null,artworkId:null,systemOverride:'Super Nintendo'});
    assert.equal(await importLaunchBoxXml(file,store),2);
    assert.equal(store.searchLaunchBox('A & B','Nintendo Entertainment System')[0].id,17);
    assert.equal(store.getLaunchBoxGame(17)?.description,'Good & old');
    assert.equal(store.queryLibrary({source:'/games',search:'',system:null,sort:'name',descending:false,offset:0,limit:10}).items[0].metadata?.title,'Manual title');
    store.close();
    const reopened=new SqliteLibraryStore(dbfile,adapter);
    assert.equal(reopened.searchLaunchBox('A &','Super Nintendo Entertainment System').length,2);
    reopened.close();
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('malformed import never replaces an existing LaunchBox catalogue', async () => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'rh-launchbox-'));
  try {
    const file=path.join(dir,'catalogue.xml'), store=new SqliteLibraryStore(path.join(dir,'library.sqlite'),adapter);
    await writeFile(file,sample(1,'Existing'));
    assert.equal(await importLaunchBoxXml(file,store),1);
    await writeFile(file,'<!DOCTYPE foo [<!ENTITY x "bad">]>'+sample(2,'New'));
    await assert.rejects(importLaunchBoxXml(file,store),/entities/);
    assert.equal(store.getLaunchBoxGame(1)?.title,'Existing');
    assert.equal(store.getLaunchBoxGame(2),null);
    store.close();
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('Libretro cover is platform-restricted, cached, and returns null on 404', async () => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'rh-libretro-'));
  try {
    const urls: string[]=[];
    const mocked: typeof fetch = async url => {
      urls.push(String(url));
      return new Response(png,{status:200,headers:{'content-type':'image/png'}});
    };
    const id=await findLibretroCover('Nintendo Entertainment System',['A & B (USA).zip'],dir,mocked);
    assert.match(id ?? '',/^[a-f0-9]{64}\.png$/);
    assert.ok(urls[0].startsWith('https://thumbnails.libretro.com/Nintendo%20-%20Nintendo%20Entertainment%20System/Named_Boxarts/'));
    assert.ok(urls[0].includes('A%20_%20B'));
    assert.equal((await getArtwork(dir,id!)).mime,'image/png');
    assert.equal(libretroCandidates(['Game (USA).zip'])[0], 'Game (USA)');
    assert.ok(libretroCandidates(['Game (USA).zip']).includes('Game'));
    await assert.rejects(findLibretroCover('Unmapped System',['Game'],dir,mocked),/No Libretro/);
    const missing=await findLibretroCover('Super Nintendo',['Missing'],dir,async () => new Response(null,{status:404}));
    assert.equal(missing,null);
    await assert.rejects(findLibretroCover('Super Nintendo',['Bad'],dir,async()=>new Response('not an image')),/supported image/);
  } finally {await rm(dir,{recursive:true,force:true});}
});


test('Libretro accepts common system names and preserves exact regional game matches', async () => {
  assert.equal(libretroPlatform('SNES'), 'Nintendo - Super Nintendo Entertainment System');
  assert.equal(libretroPlatform('nes'), 'Nintendo - Nintendo Entertainment System');
  assert.equal(libretroPlatform('Super Nintendo Entertainment System'), 'Nintendo - Super Nintendo Entertainment System');
  assert.equal(libretroPlatform('Sega Genesis'), 'Sega - Mega Drive - Genesis');
  assert.equal(libretroPlatform('Needs identification'), null);
  const candidates = libretroCandidates(['Alien 3 (Europe).zip', 'Alien 3']);
  assert.equal(candidates[0], 'Alien 3 (Europe)');
  assert.ok(candidates.includes('Alien 3 (USA, Europe)'));
  assert.ok(candidates.includes('Alien 3 (USA)'));
  assert.ok(candidates.length <= 24);
  const root = await mkdtemp(path.join(os.tmpdir(), 'rh-libretro-alias-'));
  try {
    const requested: string[] = [];
    const request: typeof fetch = async url => {
      requested.push(String(url));
      return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
    };
    const cover = await findLibretroCover('SNES', ['Alien 3 (Europe).zip'], root, request);
    assert.ok(cover);
    assert.match(requested[0], /Nintendo%20-%20Super%20Nintendo%20Entertainment%20System/);
    assert.match(requested[0], /Alien%203%20\(Europe\)\.png/);
    assert.equal(requested.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Libretro retries region-qualified filename variants after exact 404', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rh-libretro-regions-'));
  try {
    const urls: string[] = [];
    const request: typeof fetch = async url => {
      const value = String(url); urls.push(value);
      return value.includes('Alien%203%20(USA%2C%20Europe).png')
        ? new Response(png, { status: 200, headers: { 'content-type': 'image/png' } })
        : new Response(null, { status: 404 });
    };
    const found = await findLibretroCover('Game Boy', ['Alien 3 (Europe).zip'], root, request);
    assert.ok(found);
    assert.ok(urls[0].includes('Alien%203%20(Europe).png'));
    assert.ok(urls.some(url => url.includes('Alien%203%20(USA%2C%20Europe).png')));
    assert.ok(urls.length <= 24);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// Patch 008.5: catalogue-based manual cover choice, without inventing filenames.
test('Libretro catalogue finds alternate Alien 3 NES naming and ignores unrelated sequels', async () => {
  const { matchLibretroBoxarts, parseLibretroIndex } = await import('../src/main/metadata/libretro');
  const files = parseLibretroIndex('Alien 3 (1993)(LJN)(EU).png\nAlien 3 (USA).png\nAlien 2 (USA).png\nAlien 3D (USA).png\n');
  assert.deepEqual(matchLibretroBoxarts(files,'Alien 3','Alien 3 (Europe).zip'), [
    'Alien 3 (1993)(LJN)(EU).png', 'Alien 3 (USA).png'
  ]);
  assert.deepEqual(parseLibretroIndex('<a href="Alien%203%20%28Europe%29.png">art</a><a href="../bad.png">bad</a>'), [
    'Alien 3 (Europe).png'
  ]);
});

test('Libretro search returns cached image previews and skips unavailable catalogue entries', async () => {
  const { searchLibretroCovers } = await import('../src/main/metadata/libretro');
  const dir=await mkdtemp(path.join(os.tmpdir(),'rh-libretro-search-'));
  try {
    const urls:string[]=[];
    const request: typeof fetch=async url => {
      const raw=String(url); urls.push(raw);
      if (raw.endsWith('/.index')) return new Response('Alien 3 (Europe).png\nAlien 3 (1993)(LJN)(EU).png\nOther game.png\n');
      if (raw.includes('Alien%203%20(Europe)')) return new Response(null,{status:404});
      if (raw.includes('Alien%203%20%28Europe%29')) return new Response(null,{status:404});
      return new Response(png,{status:200,headers:{'content-type':'image/png'}});
    };
    const covers=await searchLibretroCovers('NES','Alien 3','Alien 3 (Europe).zip',dir,true,request);
    assert.equal(covers.length,1);
    assert.equal(covers[0].title,'Alien 3 (1993)(LJN)(EU)');
    assert.equal((await getArtwork(dir,covers[0].artworkId)).mime,'image/png');
    // The primary thumbnail host and official GitHub mirror are both allowed.
    const primary = 'https://thumbnails.libretro.com/Nintendo%20-%20Nintendo%20Entertainment%20System/Named_Boxarts/';
    const mirror = 'https://raw.githubusercontent.com/libretro-thumbnails/Nintendo_-_Nintendo_Entertainment_System/master/Named_Boxarts/';
    const missing = encodeURIComponent('Alien 3 (Europe).png');
    const available = encodeURIComponent('Alien 3 (1993)(LJN)(EU).png');
    assert.equal(urls[0], primary + '.index');
    assert.deepEqual(urls.slice(1).sort(), [primary + missing, mirror + missing, primary + available].sort());
    assert.ok(urls.indexOf(primary + missing) < urls.indexOf(mirror + missing));
  } finally {await rm(dir,{recursive:true,force:true});}
});
