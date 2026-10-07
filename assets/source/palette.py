"""Linear PBR colours: intentionally texture-free, portable authored colour blocking."""
from geometry import material


def make_palette():
    return {key:material(key,color,rough,metal) for key,color,rough,metal in [
        ('cream',(.88,.77,.58),.83,0),('paper',(.97,.92,.78),.8,0),
        ('teal',(.035,.32,.30),.76,0),('terracotta',(.64,.19,.105),.8,0),
        ('marigold',(.94,.52,.07),.65,0),('indigo',(.15,.22,.46),.75,0),
        ('skin',(.65,.36,.20),.68,0),('blush',(.67,.245,.15),.8,0),
        ('hair',(.035,.018,.015),.62,0),('hairLight',(.10,.047,.025),.67,0),
        ('ink',(.016,.037,.045),.74,0),('denim',(.045,.105,.14),.9,0),
        ('stitch',(.26,.43,.43),.82,0),('sole',(.83,.79,.67),.88,0),
        ('wood',(.40,.21,.09),.9,0),('woodLight',(.68,.41,.18),.88,0),
        ('leaf',(.075,.40,.28),.85,0),('leafLight',(.24,.57,.32),.87,0),
        ('leafDark',(.018,.21,.18),.9,0),('brass',(.69,.43,.12),.32,1),
        ('white',(.95,.96,.92),.37,0),('eye',(.012,.025,.027),.26,0),
    ]}
