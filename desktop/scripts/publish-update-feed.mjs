import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {repository,feedTag,newestDesktopRelease,updateFeedManifest} from './update-feed.mjs';

const gh=(...args)=>execFileSync('gh',args,{encoding:'utf8',maxBuffer:10*1024*1024});
const releases=JSON.parse(gh('api',`repos/${repository}/releases?per_page=100`));
const release=newestDesktopRelease(releases);
if(!release)throw new Error('No published desktop release is available');
if(process.argv[2]&&release.tag_name!==process.argv[2]){
  console.log(`Feed unchanged: ${release.tag_name} is newer than the requested release.`);
}else{
  const staging=await fs.mkdtemp(path.join(os.tmpdir(),'tokenflow-update-feed-'));
  try{
    const source=path.join(staging,'source');
    await fs.mkdir(source);
    gh('release','download',release.tag_name,'--repo',repository,'--pattern','latest*.yml','--dir',source);
    const files=[];
    for(const name of ['latest-mac.yml','latest.yml']){
      const manifest=updateFeedManifest(await fs.readFile(path.join(source,name),'utf8'),release);
      const destination=path.join(staging,name);await fs.writeFile(destination,manifest);files.push(destination);
    }
    if(releases.some(item=>item.tag_name===feedTag)){
      gh('release','upload',feedTag,'--repo',repository,'--clobber',...files);
    }else{
      gh('release','create',feedTag,'--repo',repository,'--target',release.target_commitish,'--latest=false',
        '--title','TokenFlow desktop update feed','--notes','Update manifests for TokenFlow App. Installers and release notes are available in the versioned desktop releases.',...files);
    }
    console.log(`Published ${release.tag_name} manifests to https://github.com/${repository}/releases/download/${feedTag}/`);
  }finally{await fs.rm(staging,{recursive:true,force:true});}
}
