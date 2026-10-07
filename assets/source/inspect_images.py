"""Direct local image review (not a subagent); results are evidence, not acceptance.

Run: python3 assets/source/inspect_images.py image.png [image2.png ...]
Requires the already-installed localhost Ollama vision model; no remote upload.
"""
import base64
import io
import json
import sys
import urllib.request
from pathlib import Path
from PIL import Image

for filename in sys.argv[1:]:
    path=Path(filename)
    image=Image.open(path).convert('RGB');image.thumbnail((950,950))
    buffer=io.BytesIO();image.save(buffer,format='JPEG',quality=85)
    payload={'model':'qwen2.5vl:7b','stream':False,'keep_alive':'0s',
        'messages':[{'role':'user','content':
        'Inspect this actual Blender render critically. Describe only visible evidence. '
        'Is the student clearly human and appealing, with a coherent face, swept hair, fitted clothes, shoes and backpack? '
        'Check anatomy, seams/gaps, arms/legs, visible floating or clipping objects, grip and foot ground contact if visible. '
        'If this is a prop board, inspect prop legibility and geometry instead. '
        'If a contact sheet, compare individual labelled poses. Give 4 concise observations and up to 4 concrete defects. '
        'Do not assume missing views or judge temporal quality from still images.',
        'images':[base64.b64encode(buffer.getvalue()).decode()]}],
        'options':{'temperature':.1,'num_predict':650,'num_ctx':4096}}
    req=urllib.request.Request('http://127.0.0.1:11434/api/chat',
        json.dumps(payload).encode(),{'Content-Type':'application/json'})
    result=json.load(urllib.request.urlopen(req,timeout=240))
    text=result['message']['content']
    path.with_suffix('.vision.txt').write_text(text+'\n')
    print(path.name+'\n'+text,flush=True)
