"""Instantiate bundled publishing fonts from downloaded upstream variable TTFs.

Requires fonttools. Pass a directory containing Cinzel.ttf,
CormorantGaramond.ttf and CormorantGaramond-Italic.ttf.
Copyright and SIL OFL metadata are retained; weight-specific names are updated.
"""
import sys
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

source_dir = Path(sys.argv[1])
output_dir = Path(__file__).resolve().parents[1] / 'public/fonts/publishing'
for family in ['Cinzel', 'CormorantGaramond', 'CormorantGaramond-Italic']:
    for weight in [400, 500, 600, 700]:
        font = TTFont(source_dir / f'{family}.ttf')
        instance = instantiateVariableFont(font, {'wght': weight}, inplace=True)
        display_family = 'Cinzel' if family == 'Cinzel' else 'Cormorant Garamond'
        style = {400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold'}[weight]
        if family.endswith('-Italic'):
            style = 'Italic' if weight == 400 else style + 'Italic'
        names = {1: display_family, 2: style, 4: display_family + ' ' + style,
                 6: display_family.replace(' ', '') + '-' + style,
                 16: display_family, 17: style}
        for name_id, value in names.items():
            for record in list(instance['name'].names):
                if record.nameID == name_id:
                    instance['name'].setName(value, name_id, record.platformID, record.platEncID, record.langID)
        instance.save(output_dir / f'{family}-{weight}.ttf')
