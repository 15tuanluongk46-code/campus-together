"""Create labelled contact sheets and playable H.264 motion evidence."""
from pathlib import Path
import subprocess
from PIL import Image, ImageDraw

E=Path(__file__).resolve().parent/'evidence'
clips=['idle','walk','run','pickup','drop','carryIdle','carryWalk','interact','celebrate','carrySmallIdle','carrySmallWalk']
sheet=Image.new('RGB',(5*288,len(clips)*350),(238,228,210));draw=ImageDraw.Draw(sheet)
for row,clip in enumerate(clips):
    for col,path in enumerate(sorted((E/clip).glob('pose-*.png'))):
        image=Image.open(path).convert('RGB');image.thumbnail((288,320))
        sheet.paste(image,(col*288,row*350+25));draw.text((col*288+8,row*350+8),f'{clip} | {path.stem}',fill=(15,54,53))
sheet.save(E/'motion-contact-sheet.jpg',quality=92)
for clip in clips:
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-framerate','30','-i',str(E/(clip+'-frames')/'%03d.png'),
                    '-c:v','libx264','-pix_fmt','yuv420p','-crf','19',str(E/(clip+'.mp4'))],check=True)
details=sorted(E.glob('*-detail.png'))
board=Image.new('RGB',(4*300,4*330),(238,228,210));draw=ImageDraw.Draw(board)
for index,path in enumerate(details):
    image=Image.open(path).convert('RGB');image.thumbnail((300,300))
    x=(index%4)*300;y=(index//4)*330
    board.paste(image,(x,y+25));draw.text((x+8,y+8),path.stem,fill=(15,54,53))
board.save(E/'props-contact-sheet.jpg',quality=92)
print('Two contact sheets + eleven 30fps previews written')
