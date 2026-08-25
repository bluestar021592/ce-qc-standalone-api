export const BUILTIN_SHOP_WHITELIST_VERSION = 'SHOP-WL-2026-08-25-95-ALIASES';
export const BUILTIN_SHOP_WHITELIST_SOURCE_FILE = '门店CP白名单_标准化_执行副本_95码_2026-08-05.xlsx';
export const BUILTIN_SHOP_WHITELIST_SOURCE_SHA256 = '6a6f634a2f12de7df7218b19d15c504e82088ecfb91c2d170e77a7eb66989e4c';
export const BUILTIN_SHOP_ALIAS_COUNT = 26;

const RAW = `
CP000457|Veng Sreng Co-Shop
CP000458|Airport Co-shop (ZhongYue Hotel) សណ្ធាគារ អុី សុីង
CP000479|R&F Co - shop 大象富力社区店
CP000480|PPT - Co shop CE速递 玛卡拉区邻里便利店
CP000481|TK wing Co - shop
CP000482|One Park Mart Co - Shop
CP000486|sk
CP000488|CE Phsar Kandal Co- shop
CP000495|6A co-shop
CP000496|Sky Tree Toul Sangkea Co-Shop
CP000497|Aeon 2 Co-Shop
CP000502|CE Chhouk Va 2 Co-Shop
CP000505|( Borey Grand Phnom Penh ) 山东集贸 CE 速递点
CP000506|Star city co-shop - 够意思超市
CP000508|SHV-U Mart
CP000509|Chan Heng Wat Tuol
CP000512|VT st1003 Phnom Penh Thmey
CP000513|Prek Pnov Samraong
CP000515|Airport newtown
CP000516|CE 371 Chip mong
CP000517|CE速递 Cham Puvoan Ekareach2
CP000518|速7便利店
CP000519|平价超市
CP000520|Piphup Thmey Chamkar Doung II co-shop
CP000521|CE Phsar Chak Angrae Kraom co-shop
CP000522|Borey KP National Road 3CE速递乐家超市
CP000525|Airport II co-shop (CE速递三元燕窝自提点)
CP000526|CE Toul Tompoung 1 co shop
CP000527|CE Peng Huoth Boeung Snor Athina
CP000530|CE Phsar Odem Co-shop
CP000531|CE Orussey street 63 Co-shop
CP000532|CE Phsar Olympic Co-shop
CP000533|CE Chaom Chau III co-shop
CP000534|CE Ta Khmau PhumThmey Co-shop
CP000535|CE Cbar Ampov I Co Shop
CP000536|CE Beung Salang Co-shop
CP000537|Street 261 (IFL) co-shop
CP000538|CE Wat Phneat Co-shop
CP000539|CE Toul Sangke I co-shop co-shop
CP000540|CE Veng Sreng I
CP000541|CE Preaek Chrey co-shop
CP000542|CE Phsar Toul Kork Co-shop
CP000543|CE Camko Co-shop
CP000544|CE Borey Phnom Penh Sok San co-shop
CP000545|CE Phsar Prek Pnov Co-shop
CP000546|CE Moung Ruessei BTB co-shop
CP000547|TZ03 co-shop
CP000548|Krabau Co-shop (Prey Veng)
CP000549|CE Champuvoan Borey Lorn city co-shop
CP000550|Borey Laykong 598 co-shop
CP000551|Phsar Toul Sangkae Co-Shop
CP000552|CE Samrong Andet Street 72P Co-Shop
CP000553|Phsar Panksey co-shop (中国万佳超市)
CP000554|CE Boeung Tompong I co-shop
CP000555|Northbridge Street 1019 (CE速递 1019路店)
CP000556|CE Borey Peng Im Co-shop
CP000557|CE Borey Chip Mong 598 co-shop
CP000558|CE Phnom Penh Tmey co-shop
CP000559|You Pin mall (street 167)
CP000561|Kampong Popil co-shop
CP000562|CE Preaek Samraong Ta Khmau co-shop
CP000563|Olympia co-shop
CP000565|Borey New World Chhouk Va II CE速递 新世界小区2区
CP000566|Trapang Kraleung Market co-shop
CP000567|CE Borey Piphup Chamka Doung1 co-shop
CP000568|Kob Srov Co-shop
CP000569|Modern Mall sen sok (CE速递 Modern Mall)
CP000571|Borey Vimean Phnom Penh Svay Pak
CP000572|Ou Baek K'am co-shop
CP000573|Spandek chamkar daung
CP000574|CU 24 Mart Chamkarmon co-shop
CP000575|CU 24 Mart Bak Touk co-shop
CP000576|598 Borey Chipmong Co-shop
CP000577|CU24 Super Market SHV Co-shop
CP000578|CE Phsar Leu co-shop
CP000579|Prek Leap co-shop (CE速递 水净华区自提点)
CP000580|Wat Angtaminh co-shop
CP000581|MIDO MART street 310 速递 310路米多便利店
CP000583|CE Phsa Champuvoan Co-shop
CP000584|Prey Thear Co shop ( 机场)
CP000586|Borey New World Chhouk Va 1
CP000587|Prey Nob national road 4 km183(西港泛美XGFM)
CP000588|CE Near panhasas school 598 co-shop
CP000589|Borey KC co-shop
CP000590|CE Chaom Chau II Co-shop
CP000591|CE Phsar Dei Tmey Co-shop
CP000592|CE Bek Chan National Road 4
CP000595|CE near Asian TV Co-shop
CP000596|CE Chhouk Va 3 Co-shop
CP000650|Thma Sa Koh Kong co-shop
FS000476|MG Co - Shop
FS000477|JLF Co - shop 家乐福3号路店
PNH033|KSV-PT Shop
PV042|SHV-PT
PV043|CE Chrey Thum shop (财通 CE速递)
`;

const SOURCE_ALIASES = Object.freeze({
  CP000517: Object.freeze(['ChamPuvoan Ekareach2 co-shop']),
  CP000521: Object.freeze(['Phsar Chak Angrae Kraom co shop']),
  CP000526: Object.freeze(['Toul Tompoung 1 co shop']),
  CP000531: Object.freeze(['Orussey Street 63 Co-shop']),
  CP000532: Object.freeze(['Phsar Olympic co-shop']),
  CP000533: Object.freeze(['Chaom Chau III co-shop']),
  CP000535: Object.freeze(['CE Chbar Ampov I co-shop']),
  CP000536: Object.freeze(['Beung Salang co-shop']),
  CP000538: Object.freeze(['Wat Phneat co-shop']),
  CP000539: Object.freeze(['Toul Sangke I co-shop']),
  CP000540: Object.freeze(['Lucky 168 (oppo) phone shop']),
  CP000541: Object.freeze(['Preaek Chrey']),
  CP000542: Object.freeze(['Phsar Tuol Kork']),
  CP000544: Object.freeze(['Borey Phnom Penh Sok San co-shop']),
  CP000549: Object.freeze(['Champuvoan Borey Lorn City']),
  CP000551: Object.freeze(['Phsar Tuol Sangke co-shop']),
  CP000552: Object.freeze(['Samrong Andet Street 72P Co-shop']),
  CP000554: Object.freeze(['Boeung Tompong I']),
  CP000556: Object.freeze(['Borey Peng Im']),
  CP000573: Object.freeze(['Spandek chamkar daung Co-Shop']),
  CP000580: Object.freeze(['CE Wat Angtaminh Co-shop']),
  CP000583: Object.freeze(['Phsa Champuvoan Co-shop']),
  CP000584: Object.freeze(['Prey Thear co shop']),
  CP000586: Object.freeze(['Borey New World Chhouk VA 1', 'Borey New world Chhouk Va I']),
  CP000587: Object.freeze(['SHV Prey Nob national road 4 Km 183 (西港泛美XGFM)'])
});

export const BUILTIN_SHOP_STORES = Object.freeze(RAW.trim().split('\n').map(line => {
  const separator = line.indexOf('|');
  const code = line.slice(0, separator).trim().toUpperCase();
  const name = line.slice(separator + 1).trim();
  return Object.freeze({
    shop_code: code,
    canonical_name: name,
    prefix: code.match(/^[A-Z]+/)?.[0] || '',
    aliases: SOURCE_ALIASES[code] || Object.freeze([]),
    classification_enabled: true
  });
}));

const allAliases = BUILTIN_SHOP_STORES.flatMap(row => row.aliases || []);
if (BUILTIN_SHOP_STORES.length !== 95 || new Set(BUILTIN_SHOP_STORES.map(row => row.shop_code)).size !== 95) {
  throw new Error('内置门店白名单必须保持95个唯一有效编码。');
}
if (allAliases.length !== BUILTIN_SHOP_ALIAS_COUNT) {
  throw new Error(`内置门店别名数量异常：${allAliases.length}/${BUILTIN_SHOP_ALIAS_COUNT}`);
}
