# TriBot 路 鏈湴 Bot 鍥㈤槦宸ヤ綔鍙?
鎶婁换鍔′涪缁欎竴鏀窇鍦ㄨ嚜宸辩數鑴戜笂鐨?Bot 鍥㈤槦锛氭€荤鎷嗚В銆佺爺绌跺憳鏌ヨ瘉銆佸伐绋嬪笀鍔ㄦ墜銆佺瀹跺贰妫€銆佸绋夸汉鎸戝埡銆傛ā鍨嬨€佸伐鍏枫€佹枃浠躲€佸鎵归兘鍦ㄦ湰鏈猴紝鏁版嵁涓嶅嚭闂ㄣ€?
![TriBot 涓荤晫闈(docs/screenshots/app.png)

## 瀹冩槸浠€涔?
TriBot 涓嶆槸鈥滃張涓€涓亰澶╂鈥濓紝鑰屾槸涓€涓彲瀹¤鐨勬湰鍦?Agent 宸ヤ綔鍙帮細

- **浜斾釜瑙掕壊**锛氭€荤 / 鐮旂┒鍛?/ 宸ョ▼甯?/ 绠″ / 瀹＄浜猴紝鍚勬湁绯荤粺鎻愮ず璇嶃€佽緭鍑哄绾﹀拰榛樿鎬濊€冩。浣?- **宸ヤ綔鍖?*锛氫竴涓細璇濈粦瀹氫竴涓洰褰曪紝鍙拷鍔犲涓洰褰曪紱宸︿晶鎸夊伐浣滃尯鍒嗙粍锛屽儚鏂囦欢澶逛竴鏍峰睍寮€/鏀惰捣
- **鏂囦欢渚ф爮**锛氱洿鎺ュ湪宸︿晶銆屾枃浠躲€峵ab 娴忚宸ヤ綔鍖猴紝Markdown / 浠ｇ爜 / 鍥剧墖 / PDF 鍦ㄥ彸渚ч瑙?- **浼氳瘽鏍囩椤?*锛氬儚鏂囦欢涓€鏍锋墦寮€銆佸垏鎹€佸叧闂紱鍏抽棴鏍囩涓嶅垹闄や細璇?- **鍐欏墠妫€鏌ョ偣**锛欱ot 瑕嗙洊/鏂板缓鏂囦欢鍓嶈嚜鍔ㄥ揩鐓э紝鍙充晶銆岀姸鎬併€嶉潰鏉垮彲閫愭枃浠跺洖婊?- **瀹℃壒涓庢矙绠?*锛氬彧璇?/ 宸ヤ綔鍖?/ 鍏ㄦ潈涓夋。锛涢珮鍗卞懡浠ゃ€佸缃戙€丮CP 璋冪敤閫愭瀹℃壒
- **鐪熷疄宸ュ叿**锛氳鍐欐枃浠躲€佹墽琛屽懡浠ゃ€佹祻瑙堝櫒銆佹闈㈣嚜鍔ㄥ寲銆丮CP銆丼KILL.md 鎶€鑳姐€佸畾鏃朵换鍔?- **鐢ㄩ噺閫忔槑**锛氫笂杞?鏈細璇?token銆佺紦瀛樺懡涓巼锛涜缃噷鏈夋寜妯″瀷鐨勯ゼ鍥?- **澶氫緵搴斿晢**锛欸LM銆丮iniMax銆丏eepSeek 鍐呯疆锛涗换鎰?OpenAI 鍏煎渚涘簲鍟嗗彲鑷繁鍔?
![鏂囦欢渚ф爮涓?Markdown 棰勮](docs/screenshots/files.png)

## 鐪?token 鍋氫簡浠€涔?
TriBot 鐨勫彇鑸嶆槸銆屽浐瀹氬墠缂€灏?+ 闀垮唴瀹逛笉纭銆嶃€傚疄娴嬶紙cl100k_base锛岀湡瀹炰粨搴撴枃浠?/ 鐪熷疄 Bot 閰嶇疆 / 鐪熷疄宸ュ叿 Schema锛夛細

| 鍦烘櫙 | 涓嶅鐞?| TriBot | 鐪?|
|---|---:|---:|---:|
| 鍥哄畾鍓嶇紑锛坰ystem + 17 涓伐鍏?Schema + 30 涓妧鑳藉悕锛?| 鈥?| **2,731 tokens** | Claude Code 绾?12,200 |
| 璇?3,705 琛?`pnpm-lock.yaml` | 56.2k | 1.1k | **98.1%** |
| `cat` 鎵撳寘浜х墿锛?1,158 琛岋級 | 615.3k | 626 | **99.9%** |
| 40 鏉″巻鍙插璇濆帇缂?| 12.7k | 5.2k | **58.8%** |
| 30 杞?+ 3 娆″ぇ杈撳嚭 + 6 娆￠噸澶嶈皟鐢?| 849.4k | 99.3k | **88.3%**锛埪?.425 鈫?楼0.050锛?|

鍏蜂綋鏈哄埗锛?
1. **闀垮伐鍏疯緭鍑鸿惤鐩?*锛氳秴杩?6,000 瀛楃涓嶆暣娈靛鍥炰笂涓嬫枃锛屽彧鍥炲～澶?1,800 + 灏?300 瀛楃锛岀粰妯″瀷涓€涓?`expand_output(id)` 璇诲洖鍘熸枃鐨勬妸鎵嬨€傛棦涓嶇垎绐楀彛锛屼篃涓嶄涪淇℃伅銆?2. **鍒嗘璇绘枃浠?*锛歚read_file` 榛樿鏈€澶?2,000 琛?/ 200KB锛岄暱鏂囦欢鐢?`offset/limit` 缈婚〉锛岃€屼笉鏄竴鍙ｆ皵鐏岃繘鍘汇€?3. **涓婁笅鏂囧帇缂?*锛氶暱浼氳瘽淇濈暀鏈€杩戞秷鎭?+ 鎽樿锛涘帇缂╁悗鐨勫師鏂囦粛鍙粠宸ュ叿杈撳嚭瀛樻。璇诲洖銆?4. **绋冲畾鍓嶇紑鍚冪紦瀛?*锛氱郴缁熸彁绀烘寜銆屼汉璁?鈫?鎶€鑳?鈫?浠诲姟鍗?鈫?鎽樿 鈫?鏃堕棿/鐜銆嶆帓搴忥紝鎶婃瘡鍒嗛挓鍙樺寲鐨勬椂闂存埑鏀惧埌鏈€鍚庯紝璁╁杞姹傜殑鍓嶇紑灏介噺涓嶅彉锛?0 杞疄娴嬬紦瀛樺啀鐪?44.5%銆?5. **閲嶅璋冪敤鎻愰啋**锛氬悓涓€宸ュ叿 + 鍚屼竴鍙傛暟绗?3/5/8 娆¤皟鐢ㄦ椂鎻愰啋鎹㈡€濊矾锛屽噺灏戝師鍦版墦杞儳 token銆?
> 杩欎簺鏁板瓧鏉ヨ嚜鏈粨搴撶殑 `pnpm bench` 瀹炴祴锛屼笉鏄惀閿€浼扮畻锛涗笉鍚?tokenizer / 渚涘簲鍟嗕細鏈?卤10% 宸紓銆傚畬鏁存暟鎹笌澶嶇幇鏂瑰紡瑙?[docs/token-benchmark.md](docs/token-benchmark.md)锛岀珵鍝佸姣旇 [docs/positioning.md](docs/positioning.md)銆?
## 蹇€熷紑濮?
瑕佹眰锛?*Node.js >= 22.5**銆?*pnpm >= 10**锛堜粨搴撲娇鐢?pnpm 12.6锛夈€?
```bash
pnpm install
pnpm dev
```

棣栨鍚姩锛?
1. 涓夋寮曞锛堜粙缁?鈫?閰嶇疆妯″瀷 鈫?閫変换鍔℃枃浠跺す锛?2. 鍒?**璁剧疆 鈫?妯″瀷涓庡嚟璇?* 濉?API Key锛堟帹鑽愶紱Key 鍙瓨鍦ㄦ湰鏈猴級
3. 鏂板缓浼氳瘽锛岀洿鎺ユ妸浠诲姟涓㈢粰鎬荤

鍙惎鍔ㄦ湰鍦?server锛?
```bash
pnpm dev:server
# 娴忚鍣ㄦ墦寮€ http://127.0.0.1:47615/
```

> 浠撳簱**涓嶅寘鍚换浣?API Key**銆俙data/`銆乣.env`銆乣credentials.json` 绛夊潎琚?`.gitignore` 鎺掗櫎銆?
## 甯哥敤鍛戒护

| 鍛戒护 | 浣滅敤 |
|---|---|
| `pnpm dev` | 妗岄潰 App锛圗lectron + 鏈湴 server锛?|
| `pnpm dev:server` | 鍙惎鍔ㄦ湰鍦?server锛屾祻瑙堝櫒璁块棶 |
| `pnpm dev:web` | 鍙惎鍔?Vite 娓叉煋灞?|
| `pnpm test` | 鍏ㄩ儴鍗曟祴 |
| `pnpm typecheck` | 鍏ㄤ粨绫诲瀷妫€鏌?|
| `pnpm cli -- chat` | 鍛戒护琛岃亰澶╋紙`tb`锛?|
| `pnpm package` | Windows Electron 渚挎惡鐗?鈫?`release/` |
| `pnpm package:native` | Windows 鍘熺敓澹筹紙C# + WebView2锛夆啋 `release/TriBotNative` |
| `pnpm package:targets` | 鐢熸垚涓嬭浇绔欎骇鐗╋紙Windows / macOS / Linux锛?|

## 鏋舵瀯

```
packages/
鈹溾攢鈹€ core/     寮曟搸锛氭ā鍨嬬綉鍏炽€佽矾鐢便€侀厤棰濄€佸伐鍏锋墽琛屻€佸鎵归棬銆佹矙绠便€?鈹?            涓婁笅鏂囧帇缂┿€丼KILL.md銆丮CP銆丷outine
鈹溾攢鈹€ server/   Fastify REST + SSE锛屽彧鐩戝惉 127.0.0.1
鈹溾攢鈹€ app/      Electron 涓昏繘绋?+ React 宸ヤ綔鍙?+ 鍘熺敓澹宠祫婧?鈹溾攢鈹€ cli/      tb 鍛戒护琛岋紙闆朵緷璧?HTTP 瀹㈡埛绔級
鈹斺攢鈹€ shared/   涓夌鍏变韩绫诲瀷涓庡崗璁?shell/        Windows C# + WebView2 鍘熺敓澹?/ macOS路Linux Python + 绯荤粺 WebView
site/         闈欐€佷笅杞介〉
scripts/      鎵撳寘銆佸熀鍑嗐€佽瘎娴?docs/         瀹夊叏銆佽鑹层€佽璁°€佸師鐢熷３璇存槑
```

鏁版嵁娴侊細

```
UI 鈫?鏈湴 server(127.0.0.1) 鈫?寮曟搸锛堣矾鐢?/ 宸ュ叿寰幆 / 瀹℃壒锛?   鈫?SQLite(data/tribot.db) + 宸ヤ綔鍖烘枃浠?+ 鍑瘉瀵嗘枃
```

## 浼氳瘽涓庡伐浣滃尯

- 浼氳瘽鎸夊伐浣滃尯鍒嗙粍锛涙枃浠跺す澶?`+` 鐩存帴鍦ㄨ宸ヤ綔鍖烘柊寤轰細璇?- 浼氳瘽鏍囬鍦ㄩ杞悗鐢辨ā鍨嬫€荤粨鐢熸垚锛屼笉鍐嶆埅鍙栫涓€鍙ヨ瘽锛涘弻鍑绘垨鍙抽敭鍙噸鍛藉悕
- 鑷畾涔夋爣棰樺啓鍏?`meta.titleSource = custom`锛屼箣鍚庝笉浼氳鑷姩瑕嗙洊
- 浼氳瘽鏍囩椤垫寔涔呭寲锛涘叧闂爣绛惧彧鍏宠鍥撅紝涓嶅垹浼氳瘽

## 瀹夊叏

- API Key 浣跨敤 **AES-256-GCM** 鍔犲瘑瀛?`data/credentials.json`
- 妗岄潰鐗堜富瀵嗛挜鐢辩郴缁?DPAPI / Keychain锛圗lectron safeStorage锛変繚鎶わ紱绾?Node 妯″紡鐢ㄦ湰鏈?`.localkey` 鍏滃簳
- 鐣岄潰鍙洖鏄?`鈥﹀熬鍙穈锛屼笉杩斿洖瀹屾暣 Key
- 鏈嶅姟鍙粦瀹?`127.0.0.1`
- 鏂囦欢璇诲啓閿佸湪浼氳瘽宸ヤ綔鍖哄唴锛涜矾寰勮秺鐣岀洿鎺ユ嫆缁?- 楂樺嵄鍔ㄤ綔閫愭瀹℃壒锛屾巿鏉冨彲闄愬畾銆屾湰浼氳瘽 / 鎬绘槸銆嶏紝璁剧疆閲屽彲鎾ら攢
- 鍙戝竷鍖呬笉鍖呭惈 `data/`銆乣.env`銆乣credentials.json`

瀹屾暣璇存槑锛歔docs/security.md](docs/security.md)

## 鍘熺敓澹筹紙涓嶇敤 Electron锛?
| 骞冲彴 | 瀹炵幇 | 鐘舵€?|
|---|---|---|
| Windows | C# WinForms + WebView2锛屽師鐢熸爣棰樻爮 | 宸叉瀯寤?|
| macOS | Python + WKWebView | 婧愮爜鍖?|
| Linux | Python + WebKitGTK | 婧愮爜鍖?|

```bash
pnpm package:native
# release/TriBotNative/TriBotShell.exe
```

macOS / Linux 闇€瑕佸悇鑷钩鍙扮紪璇戜笌绛惧悕锛屼粨搴撴彁渚?`shell/tribot_shell.py` 涓庡畨瑁呰鏄庛€傝瑙?[docs/native-shell.md](docs/native-shell.md)銆?
## 娴嬭瘯涓庤川閲?
```bash
pnpm test        # 165+ 鍗曟祴锛氳矾鐢?娌欑/瀹℃壒/鍑瘉/鍘嬬缉/宸ュ叿/妫€鏌ョ偣
pnpm typecheck
```

鍏抽敭璁捐锛?
- 鎵€鏈?Bot 榛樿鎷ユ湁鍏ㄩ儴宸ュ叿锛坄["*","assign"]`锛夛紝椋庨櫓鐢辨矙绠变笌瀹℃壒鍏滃簳
- 鍐欐枃浠跺墠鍏?`read_file`锛岄伩鍏嶇洸鍐欒鐩?- 宸ュ叿杈撳嚭杩囬暱鑷姩钀界洏锛屾ā鍨嬪彲鐢?`expand_output` 璇诲洖
- 鍚屼竴宸ュ叿閲嶅璋冪敤浼氭彁閱掓崲鎬濊矾
- 杈撳嚭鎴柇鑷姩缁啓锛屼笉浼氱洿鎺ュけ璐?
## 鍦?ZCode / DSH 閲屼娇鐢?TriBot 鐨?Bot

TriBot 鐨勪簲涓鑹插悎骞舵垚浜嗕竴涓妧鑳斤紝婧愭枃浠跺湪 [`zcode-skills/tribot/SKILL.md`](zcode-skills/tribot/SKILL.md)銆俍Code 鍜?DSH 鍏辩敤鍚屼竴浠藉唴瀹癸紙鍚屾椂鍐欎簡 `when_to_use` 涓?`whenToUse`锛夈€?
**ZCode**

```bash
cp -R zcode-skills/tribot ~/.zcode/skills/
```

**DSH锛圖eepSeek Harness锛?*

```bash
cp -R zcode-skills/tribot ~/.dsh/skills/
```

鍔犺浇 `tribot` 鍚庝細鍏堣浣犻€夎鑹诧細

```
1. 馃Л 鎬荤   2. 馃攳 鐮旂┒鍛?  3. 馃洜 宸ョ▼甯?4. 鈴?绠″   5. 馃И 瀹＄浜?  6. 馃懃 鍥㈤槦
```

鍥炲缂栧彿鎴栧悕瀛楀嵆鍙紱涔熷彲浠ョ洿鎺ヨ銆岀敤宸ョ▼甯堛€嶃€傛妧鑳藉彧鏄寚浠わ紝涓嶅惈鍙墽琛屼唬鐮佹垨 API Key銆?璇﹁ [zcode-skills/README.md](zcode-skills/README.md) 鍜?[dsh-skills/README.md](dsh-skills/README.md)銆?
## License

MIT 漏 2026 Zhanjian Li銆傝 [LICENSE](LICENSE)銆?