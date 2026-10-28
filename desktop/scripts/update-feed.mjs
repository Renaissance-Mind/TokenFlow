import {load,dump} from 'js-yaml';

export const repository='Renaissance-Mind/TokenFlow';
export const feedTag='desktop-latest';
export function desktopVersion(tag){
  const match=/^desktop-v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  return match?match.slice(1).map(Number):null;
}
export function newestDesktopRelease(releases){
  return releases.filter(release=>desktopVersion(release.tag_name)&&!release.draft&&!release.prerelease)
    .sort((a,b)=>{
      const left=desktopVersion(a.tag_name),right=desktopVersion(b.tag_name);
      for(let i=0;i<3;i++)if(left[i]!==right[i])return right[i]-left[i];
      return 0;
    })[0];
}
export function updateFeedManifest(source,release){
  if(!desktopVersion(release.tag_name))throw new Error('Invalid desktop release tag');
  const manifest=load(source);
  if(manifest?.version!==release.tag_name.slice(9)||!Array.isArray(manifest.files)||!manifest.files.length)throw new Error('Update manifest does not match the release');
  const assets=new Map(release.assets.map(asset=>[asset.name,asset]));
  const base=`https://github.com/${repository}/releases/download/${release.tag_name}/`;
  for(const file of manifest.files){
    if(typeof file.url!=='string'||!/^[A-Za-z0-9._-]+$/.test(file.url)||!file.url.startsWith(`TokenFlow-${manifest.version}-`))throw new Error('Invalid update asset path');
    const asset=assets.get(file.url);
    if(!asset||asset.size!==file.size||asset.state!=='uploaded'||!Number.isSafeInteger(file.size)||file.size<=0)throw new Error('Update asset is missing or has the wrong size');
    if(typeof file.sha512!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(file.sha512))throw new Error('Update asset is missing its SHA-512');
    file.url=base+encodeURIComponent(file.url);
  }
  const primary=manifest.files.find(file=>file.url===base+manifest.path);
  if(!primary||manifest.sha512!==primary.sha512)throw new Error('Legacy update path does not match an asset');
  manifest.path=primary.url;
  return dump(manifest,{lineWidth:-1});
}
