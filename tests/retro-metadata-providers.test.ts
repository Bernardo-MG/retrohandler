import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SqliteLibraryStore, type DatabaseHandle, type Statement } from '../src/main/database/library-store';
import { importLaunchBoxXml, parseLaunchBoxGame, xmlText } from '../src/main/metadata/launchbox';
import { findLibretroCover, libretroCandidates } from '../src/main/metadata/libretro';
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
    assert.deepEqual(libretroCandidates(['Game (USA).zip']),['Game (USA)','Game']);
    await assert.rejects(findLibretroCover('Unmapped System',['Game'],dir,mocked),/No Libretro/);
    const missing=await findLibretroCover('Super Nintendo',['Missing'],dir,async () => new Response(null,{status:404}));
    assert.equal(missing,null);
    await assert.rejects(findLibretroCover('Super Nintendo',['Bad'],dir,async()=>new Response('not an image')),/supported image/);
  } finally {await rm(dir,{recursive:true,force:true});}
});
