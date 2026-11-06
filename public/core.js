/* Fidel core: the phonetic typing engine and the level data.
   One file, used by BOTH the browser (loaded with <script src="core.js">) and the Node server (require). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { Object.assign(root, api); }
})(typeof self !== 'undefined' ? self : globalThis, function () {

  const ROWS = [
    ['h', 0x1200], ['l', 0x1208], ['m', 0x1218], ['ss', 0x1220], ['r', 0x1228], ['s', 0x1230], ['sh', 0x1238], ['q', 0x1240],
    ['b', 0x1260], ['v', 0x1268], ['t', 0x1270], ['ch', 0x1278], ['n', 0x1290], ['gn', 0x1298], ["'", 0x12A0],
    ['k', 0x12A8], ['kh', 0x12B8], ['w', 0x12C8], ['z', 0x12D8], ['zh', 0x12E0], ['y', 0x12E8], ['d', 0x12F0],
    ['j', 0x1300], ['g', 0x1308], ["t'", 0x1320], ["ch'", 0x1328], ["p'", 0x1330], ['ts', 0x1338], ['f', 0x1348], ['p', 0x1350]
  ];
  const VOW = [['ie', 5], ['ee', 5], ['aa', 4], ['e', 1], ['u', 2], ['i', 3], ['a', 4], ['o', 7]];
  const SUFFIX = { 1: ['e'], 2: ['u'], 3: ['i'], 4: ['a', 'aa'], 5: ['ie', 'ee'], 6: [''], 7: ['o'] };
  const BASE = {};
  ROWS.forEach(([t, b]) => { BASE[t] = b; });
  BASE['ny'] = 0x1298; // ny -> ኘ
  BASE['c'] = 0x1328;  // c -> ጨ (accessible single-key typing)
  const CONS = Object.keys(BASE).sort((a, b) => b.length - a.length);

  // Roman letters typed so far -> Fidel text
  function parse(s) {
    let out = '', i = 0;
    while (i < s.length) {
      if (s[i] === ' ') { out += ' '; i++; continue; }
      const cons = CONS.find(t => s.startsWith(t, i));
      let base, j = i;
      if (cons) {
        base = BASE[cons];
        j = i + cons.length;
        const v = VOW.find(([t]) => s.startsWith(t, j));
        let ord = 6;
        if (v) { ord = v[1]; j += v[0].length; }
        out += String.fromCharCode(base + ord - 1);
        i = j;
      } else {
        let isApos = s[i] === "'";
        let pos = isApos ? i + 1 : i;
        const v = VOW.find(([t]) => s.startsWith(t, pos));
        if (v || isApos) {
          let ord = 6;
          if (v) {
            if (v[0] === 'a') ord = 1;
            else if (v[0] === 'aa') ord = 4;
            else if (v[0] === 'e') ord = isApos ? 1 : 6;
            else ord = v[1];
            pos += v[0].length;
          } else {
            ord = 6;
          }
          out += String.fromCharCode(0x12A0 + ord - 1);
          i = pos;
        } else {
          i++;
        }
      }
    }
    return out;
  }

  // Fidel glyph -> the roman spellings that produce it (first one is the canonical hint)
  function glyphOptions(g) {
    if (g === ' ') return [' '];
    const c = g.charCodeAt(0);
    if (c >= 0x12A0 && c < 0x12A7) {
      const o = c - 0x12A0 + 1;
      switch (o) {
        case 1: return ['a', "'e", "'a"];
        case 2: return ['u', "'u"];
        case 3: return ['i', "'i"];
        case 4: return ['aa', 'a', "'aa"];
        case 5: return ['ie', 'ee', "'ie"];
        case 6: return ['e', "'", "'e"];
        case 7: return ['o', "'o"];
      }
    }
    for (const [t, b] of ROWS) {
      if (t === "'") continue;
      if (c >= b && c < b + 7) {
        const o = c - b + 1;
        const suf = SUFFIX[o];
        const res = suf.map(s => t + s);
        if (t === 'gn') suf.forEach(s => res.push('ny' + s));
        else if (t === "ch'") suf.forEach(s => res.push('c' + s));
        return res;
      }
    }
    return [g];
  }
  function variants(target) {
    let acc = [''];
    for (const g of target) {
      const opts = glyphOptions(g), next = [];
      for (const a of acc) for (const s of opts) next.push(a + s);
      acc = next.slice(0, 64);
    }
    return acc;
  }

  /* ---------- Level data ---------- */
  const FIRST = 'ሀለመረሰሸቀበተነከወዘየደገፈ'.split('');
  const FAMILY_ROWS = ['h', 'l', 'm', 'r', 's', 'b', 't', 'n', 'k', 'w', 'z', 'y', 'd', 'g', 'f'];
  // Everyday words with English meanings (used by Practice > Words, the speed test and the Word dash level).
  // Only letters the phonetic keyboard can type. Have a native speaker review before classroom use.
  const VOCAB = [
    ['ሰላም', 'peace / hello'], ['ቤት', 'house'], ['ሀገር', 'country'], ['ደስታ', 'happiness'], ['ፍቅር', 'love'],
    ['ቡና', 'coffee'], ['ወንዝ', 'river'], ['ምግብ', 'food'], ['ሰማይ', 'sky'], ['ከተማ', 'city'],
    ['ወንድም', 'brother'], ['ሴት', 'woman'], ['ሰው', 'person'], ['ልጅ', 'child'], ['ቀን', 'day'],
    ['ሌሊት', 'night'], ['ጨረቃ', 'moon'], ['ከዋክብት', 'stars'], ['ትምህርት', 'education / lesson'], ['ስራ', 'work'],
    ['ዛፍ', 'tree'], ['ተራራ', 'mountain'], ['ባህር', 'sea'], ['ዝናብ', 'rain'], ['ንፋስ', 'wind'],
    ['ወፍ', 'bird'], ['ድመት', 'cat'], ['ውሻ', 'dog'], ['ዶሮ', 'chicken'], ['ላም', 'cow'],
    ['ፈረስ', 'horse'], ['ግመል', 'camel'], ['በሬ', 'ox'], ['ወተት', 'milk'], ['ዳቦ', 'bread'],
    ['ሻይ', 'tea'], ['ጨው', 'salt'], ['መኪና', 'car'], ['መንገድ', 'road'], ['ገበያ', 'market'],
    ['ሆስፒታል', 'hospital'], ['ሙዚቃ', 'music'], ['ወንበር', 'chair'], ['መስኮት', 'window'], ['ጀልባ', 'boat']
  ];
  const WORDS = VOCAB.map(v => v[0]);

  // Every letter the keyboard can type: one family per consonant, seven forms each (203 letters)
  const FAMILIES = ROWS.map(([token, base]) => ({
    token,
    glyphs: [0, 1, 2, 3, 4, 5, 6].map(k => String.fromCharCode(base + k))
  }));
  const SENTENCES = ['ሰላም ነው', 'ቤት ነው', 'ቡና ነው', 'ሀገር ሰላም ነው', 'ደስታ ነው'];
  const LONG_SENTENCES = [
    'ወንዝ ትልቅ ነው', 'ከተማ ትልቅ ናት', 'ሰማይ ሰማያዊ ነው', 'ቡና ጥሩ ነው', 'ልጅ ትንሽ ነው',
    'ሀገር ቤት ሰላም ነው', 'ከተማ ውስጥ ቡና ጥሩ ነው', 'ቤት ውስጥ ሰላም ነው',
    'ወንዝ ትልቅ ነው ሰማይ ሰማያዊ ነው', 'ከተማ ትልቅ ናት ሀገር ሰላም ነው'
  ];

  // 14 cohesive Amharic stories/paragraphs for multiplayer races
  const PARAGRAPHS = [
    {
      title: 'የቡና ባህል',
      sentences: [
        'ኢትዮጵያ የቡና መገኛ ሀገር ናት',
        'በሀገራችን ቡና መጠጣት ትልቅ ባህል እና ፍቅር ነው',
        'ቤተሰብ እና ጎረቤት በሰላም ተሰብስበው ቡና ይጠጣሉ',
        'ሁሉም ሰው በደስታ ይጫወታል ፍቅርንም ይጋራል'
      ]
    },
    {
      title: 'ሰላም እና አንድነት',
      sentences: [
        'ሰላም ለሰው ልጆች ሁሉ ትልቅ ሀብት ነው',
        'በቤት ውስጥ እና በሀገር ውስጥ ሰላም ሲኖር ደስታ ይበዛል',
        'ፍቅር እና መረዳዳት አንድነትን ያጠናክራሉ',
        'በጋራ በመስራት ሀገራችንን እናሳድጋለን'
      ]
    },
    {
      title: 'ውብ ተፈጥሮ',
      sentences: [
        'ሀገራችን ረጅም ተራራ እና ሰፊ ወንዝ አላት',
        'ለምለም ዛፎች እና ቆንጆ አበቦች ምድርን ያስውባሉ',
        'ጠዋት ላይ ወፎች በደስታ ይዘምራሉ',
        'የተፈጥሮ ንጹህ ንፋስ ልብን ደስ ያሰኛል'
      ]
    },
    {
      title: 'ትምህርት እና እውቀት',
      sentences: [
        'ትምህርት ለህይወት ብርሃን እና መመሪያ ነው',
        'ልጆች በትምህርት ቤት ብዙ አዳዲስ ነገሮችን ይማራሉ',
        'እውቀት ያለው ሰው ለራሱ እና ለሀገሩ ይጠቅማል',
        'መጽሀፍ ማንበብ አእምሮን ያበለጽጋል'
      ]
    },
    {
      title: 'ስራ እና ጥረት',
      sentences: [
        'ስራ የሰው ልጅ መገለጫ እና የክብር ምንጭ ነው',
        'በጥረት እና በትጋት የሚሰራ ሰው ውጤት ያገኛል',
        'ስንፍናን አርቀን በርትተን መስራት አለብን',
        'የዛሬ ድካም ለነገ መልካም ፍሬ ያፈራል'
      ]
    },
    {
      title: 'ቤተሰብ እና ፍቅር',
      sentences: [
        'ቤተሰብ የማህበረሰብ መሰረት እና ዋልታ ነው',
        'እናት እና አባት ለልጆቻቸው ፍቅርን ይሰጣሉ',
        'ወንድም እና እህት በፍቅር እና በመከባበር አብረው ያድጋሉ',
        'የሰላም ቤት ሁልጊዜ በደስታ ይሞላል'
      ]
    },
    {
      title: 'ገበያ እና ንግድ',
      sentences: [
        'የገበያ ቀን ሰዎች በጠዋት ይነሳሉ',
        'ገበሬዎች እህል ፍራፍሬ እና አትክልት ይዘው ይመጣሉ',
        'ሸማቾች የሚፈልጉትን በደስታ ይገዛሉ',
        'ገበያው በሰዎች ንግግር እና ሳቅ ይደመቃል'
      ]
    },
    {
      title: 'ዝናብ እና ገበሬ',
      sentences: [
        'ዝናብ ሲዘንብ ምድር በውሃ ትለሰልሳለች',
        'ገበሬው በሬዎቹን ጠምዶ ማሳውን ያርሳል',
        'ዘር ይዘራል ተስፋም በልቡ ያብባል',
        'ጥሩ ምርት ለሁሉም ህዝብ ምግብ ይሆናል'
      ]
    },
    {
      title: 'ወዳጅነት እና መረዳዳት',
      sentences: [
        'ጥሩ ወዳጅ በችግር ቀን ከጎንህ ይቆማል',
        'በደስታም በሀዘንም አብሮ የሚሆን እውነተኛ ወዳጅ ነው',
        'እርስ በርስ መረዳዳት ህይወትን ያቀላል',
        'የወዳጅነት ፍቅር ሁልጊዜ በልብ ውስጥ ይኖራል'
      ]
    },
    {
      title: 'ጥበብ እና ሙዚቃ',
      sentences: [
        'ሙዚቃ እና ዜማ የነፍስ ምግብ ናቸው',
        'የሀገራችን ባህላዊ ሙዚቃ ልብን ይነካል',
        'በደስታ ቀን ሰዎች በዜማ ይዘፍናሉ ይጨፍራሉ',
        'ጥበብ የህዝብን ታሪክ እና ማንነት ያንጸባርቃል'
      ]
    },
    {
      title: 'ጤና እና ንጽህና',
      sentences: [
        'ጤና ከሁሉ በላይ ትልቅ ጸጋ ነው',
        'ንጹህ ውሃ መጠጣት እና ጥሩ ምግብ መመገብ ይጠቅማል',
        'አካላዊ እንቅስቃሴ ማድረግ ሰውነትን ያጠነክራል',
        'ጤናማ አእምሮ በጤናማ ሰውነት ውስጥ ይገኛል'
      ]
    },
    {
      title: 'ምሽት እና ከዋክብት',
      sentences: [
        'ጸሀይ ስትጠልቅ ሰማዩ ቀይ እና ወርቃማ ይሆናል',
        'ምሽት ሲመጣ ጨረቃ እና ከዋክብት ያበራሉ',
        'ሰዎች የቀኑን ድካም አሳርፈው ወደ ቤታቸው ይመለሳሉ',
        'የምሽት ጸጥታ ሰላምን እና እረፍትን ይሰጣል'
      ]
    },
    {
      title: 'አዲስ ቀን እና ተስፋ',
      sentences: [
        'ጠዋት ጸሀይ ስትወጣ አዲስ ቀን ይጀምራል',
        'እያንዳንዱ ቀን አዲስ እድል እና አዲስ ተስፋ ይዞ ይመጣል',
        'ትናንትን አልፈን ለነገው መልካም ነገር እንተጋለን',
        'በፈገግታ እና በመልካምነት ቀናችንን እናስውባለን'
      ]
    },
    {
      title: 'ፍቅር እና መልካምነት',
      sentences: [
        'መልካምነት ምንም ወጪ የማይጠይቅ ትልቅ ስጦታ ነው',
        'ለተቸገረ ሰው እጅ መዘርጋት መልካም ተግባር ነው',
        'መልካም ቃል የሰውን ልብ ያጽናናል ደስታንም ይፈጥራል',
        'ፍቅር ባለበት ቦታ ሁሉ ሰላም እና በረከት አለ'
      ]
    }
  ];

  function pick(arr, n) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a.slice(0, n);
  }

  // The items for one race at a given level (1-5)
  function makeItems(id) {
    switch (id) {
      case 1: return pick(FIRST, 10);
      case 2: return pick(FAMILY_ROWS, 4).map(t => [0, 1, 2, 3, 4, 5, 6].map(k => String.fromCharCode(BASE[t] + k)).join(''));
      case 3: return pick(WORDS, 8);
      case 4: return pick(SENTENCES, 1).concat(
        pick(LONG_SENTENCES.filter(s => s.length <= 15), 2),
        pick(LONG_SENTENCES.filter(s => s.length > 15), 2));
      case 5: {
        const p = pick(PARAGRAPHS, 1)[0];
        return p.sentences.slice();
      }
      default: {
        const p = pick(PARAGRAPHS, 1)[0];
        return p.sentences.slice();
      }
    }
  }

  return { ROWS, VOW, SUFFIX, BASE, CONS, parse, glyphOptions, variants,
           FIRST, FAMILY_ROWS, VOCAB, WORDS, FAMILIES, SENTENCES, LONG_SENTENCES, PARAGRAPHS, pick, makeItems };
});
