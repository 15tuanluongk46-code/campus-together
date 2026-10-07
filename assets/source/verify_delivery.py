"""Final independent manifest/source/evidence checks, ordinary Python 3."""
import ast
import hashlib
import json
import subprocess
from pathlib import Path

SOURCE=Path(__file__).resolve().parent;ROOT=SOURCE.parents[1]
OUT=ROOT/'apps/client/public/assets';E=SOURCE/'evidence'
manifest=json.loads((OUT/'manifest.json').read_text())
validation=json.loads((E/'validation.json').read_text())
assert validation['pass'] and not validation['errors']
for path in SOURCE.glob('*.py'):ast.parse(path.read_text(),filename=str(path))
for name,entry in manifest['files'].items():
    path=OUT/name
    assert hashlib.sha256(path.read_bytes()).hexdigest()==entry['sha256'],name
assert (SOURCE/'campus-assets.blend').stat().st_size>100000
clips={}
for name,info in manifest['animations'].items():
    result=subprocess.run(['ffprobe','-v','error','-show_entries','stream=nb_frames,r_frame_rate,width,height',
                           '-of','json',str(E/(name+'.mp4'))],capture_output=True,text=True,check=True)
    stream=json.loads(result.stdout)['streams'][0]
    assert stream['r_frame_rate']=='30/1'
    assert abs(int(stream['nb_frames'])-info['duration']*30)<.01
    clips[name]=stream
motions=[m for name,data in validation['files'].items() if name.startswith('student-') for m in data['motion'].values()]
result={'pass':True,'glbCount':len(manifest['files']),'totalGlbBytes':sum(v['bytes'] for v in manifest['files'].values()),
        'characterTriangles':[manifest['files'][f'student-{i}.glb']['triangles'] for i in range(4)],
        'heightM':manifest['files']['student-0.glb']['restBoundsGltf'][1][1],
        'maxStanceResidualM':max(m.get('virtualGroundStanceResidualM',0) for m in motions),
        'maxGripTranslationDriftM':max(m.get('gripTranslationDriftM',0) for m in motions),
        'maxGripAngleDriftRad':max(m.get('gripAngleDriftRad',0) for m in motions),
        'minimumAnimatedGroundM':min(m['minZ'] for m in motions),'previews':clips,
        'visualReview':'local qwen2.5vl sampled image critique; see .vision.txt; not human acceptance',
        'temporalReview':'Full-frame 30fps renders encoded and ffprobe-verified; subjective playback not verified'}
(E/'delivery-check.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
