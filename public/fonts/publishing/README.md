# Bundled publishing fonts

Sources: [Cinzel](https://github.com/google/fonts/tree/main/ofl/cinzel) and
[Cormorant Garamond](https://github.com/google/fonts/tree/main/ofl/cormorantgaramond)
from Google Fonts. The accompanying SIL Open Font License files are retained.

Static 400/500/600/700 faces are instantiated from the upstream variable TTFs.
Original copyright/license metadata remains intact; weight/style names identify
the static instances. `scripts/build-publishing-fonts.py` reproduces the instances
with fonttools and the three source filenames described in its module docstring.

Downloaded source blob identities:

- `Cinzel[wght].ttf`: Git blob `d218a0b9c8879fd5a708872cc0ef357e507b35ca`
- `CormorantGaramond-Italic[wght].ttf`: Git blob `0d914e7663b7a1429d06ec60a5c5bb026031a2ef`
- `CormorantGaramond[wght].ttf`: Git blob `d992a83ce525c330fad3a19087746bcb2dc038ee`

Bundled file SHA-256 values:

- `Cinzel-400.ttf`: `32c3ab667fadeff87868a4437c4253a80599336aeffc31b2c96135ce1db418be`
- `Cinzel-500.ttf`: `117a894ca3145571219dbcc7875ed1fd8c89e18e06b3d0bc8a4732a452a54ea6`
- `Cinzel-600.ttf`: `153c7d3a49b63e701af06843fe11c1bcafd641d35e4238f06674306b7cb29a8a`
- `Cinzel-700.ttf`: `8213d9da6012a9a5f59bc5512105c9282e06a8bc4c29286922875a2069571695`
- `CormorantGaramond-400.ttf`: `97c4d714a014080294baab36417610ee5617cb88413ecbf1a9306970636dc872`
- `CormorantGaramond-500.ttf`: `2ed2fd7d2e66b2b46dc6b12960bd578023648fc65044e08d88964464a500bedb`
- `CormorantGaramond-600.ttf`: `db05b9986302ec82608c4d93cf5f649b33d0126ac99971484ace98a070ab05b6`
- `CormorantGaramond-700.ttf`: `f7b956d38809b9d8af06d3c2d410a44b51f1ba62cea4f69144461a5f7bf4906c`
- `CormorantGaramond-Italic-400.ttf`: `b67cb76d51656874fbb50208aee4526db74c1a9d6f3562b18d7356e8c5dbaa2f`
- `CormorantGaramond-Italic-500.ttf`: `b4a8a5e601786975e89e671ab957ddacaa9a58b3b916d484a264ebff8217598a`
- `CormorantGaramond-Italic-600.ttf`: `4643e6c97f4076cd6c1a473e729ce2905e9ebd71b6ef1a467ab0c24696e2611f`
- `CormorantGaramond-Italic-700.ttf`: `252f686a7a845cd1412708b67c22d14b6074391e8358b8ac2d31ae6467bd667d`
