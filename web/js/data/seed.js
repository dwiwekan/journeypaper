// Sample papers shown on first visit. Changing them needs a SEED_V bump in config.js.
import { SECTIONS } from '../config.js';

/* ---------- sample data ---------- */
const DAY = 86400000;
const T0 = Date.now();
const P = (text) => ({ type: 'p', text });
const H3 = (text) => ({ type: 'h3', text });
const UL = (text) => ({ type: 'ul', text });
const CALLOUT = (text) => ({ type: 'callout', text });
const EQ = (tex) => ({ type: 'equation', tex });
/* Sections without content still appear as a heading with an empty paragraph. */
function doc(parts) {
  const out = [];
  SECTIONS.forEach(([key, title]) => {
    out.push({ type: 'h2', text: title });
    const items = parts[key];
    if (items && items.length) out.push(...items); else out.push(P(''));
  });
  return out;
}

export const SEED = [
  {
    title: 'Attention Is All You Need', authors: 'Vaswani et al.', year: 2017, venue: 'NeurIPS', tags: ['transformer', 'nlp'], status: 'done', rating: 5,
    summary: 'Introduces the Transformer, an architecture built entirely on self-attention with no recurrence or convolution. It became the foundation of almost every large language model today.',
    link: 'https://arxiv.org/abs/1706.03762', createdAt: T0 - 40 * DAY,
    content: doc({
      intro: [
        P('Before the Transformer, sequence-to-sequence models were dominated by RNNs, LSTMs, and GRUs that process tokens one at a time. That sequential processing makes parallelization hard and long-range dependencies difficult to learn.'),
        CALLOUT('Core idea: replace recurrence with <b>self-attention</b> so every position can be processed in parallel.'),
      ],
      related: [
        P('Earlier attempts to reduce sequential computation used convolutions, such as ConvS2S and ByteNet. The number of operations needed to relate two positions grows with their distance (linearly in ConvS2S, logarithmically in ByteNet), while in the Transformer it is constant.'),
      ],
      method: [
        H3('Scaled dot-product attention'),
        P('The output is a weighted sum of the values, with weights from how well each query matches each key.'),
        EQ('\\mathrm{Attention}(Q,K,V)=\\mathrm{softmax}\\left(\\frac{QK^{\\top}}{\\sqrt{d_k}}\\right)V'),
        P('Dividing by <code>√d_k</code> keeps the dot products from growing too large, so the softmax does not saturate.'),
        H3('Multi-head attention'),
        UL('Queries, keys, and values are projected into several subspaces, and attention is computed in parallel for each head.'),
        UL('The outputs of all heads are concatenated and projected again.'),
        UL('Sinusoidal positional encodings are added because the model has no recurrence.'),
        CALLOUT('Reread before writing related work: the multi-head attention and positional encoding parts.'),
      ],
      results: [
        P('Evaluated on WMT 2014 machine translation.'),
        UL('English to German: 28.4 BLEU'),
        UL('English to French: 41.8 BLEU, trained for 3.5 days on eight GPUs'),
      ],
      concl: [
        P('The Transformer trains faster and performs better than recurrent or convolutional models on translation. The authors plan to extend it to modalities beyond text.'),
      ],
    }),
  },
  {
    title: '3D Scene Graph: A Structure for Unified Semantics, 3D Space, and Camera', authors: 'Armeni et al.', year: 2019, venue: 'ICCV', tags: ['3d-scene-graph', 'semantics'], status: 'done', rating: 4,
    summary: 'Proposes a layered scene graph (building, room, object, camera) that links semantics with 3D space, annotated semi-automatically on the Gibson dataset.',
    link: 'https://arxiv.org/abs/1910.02527', createdAt: T0 - 31 * DAY,
    content: doc({
      intro: [P('Semantics, 3D space, and cameras are usually treated separately. This paper unifies them in a single graph.')],
      method: [
        H3('Four layers'),
        UL('<b>Building</b>, the building as a whole'),
        UL('<b>Room</b>, rooms inside the building'),
        UL('<b>Object</b>, objects inside the rooms'),
        UL('<b>Camera</b>, viewpoints that observe objects and rooms'),
        CALLOUT('The layer definitions and their relations are a good reference when explaining graph structure.'),
      ],
    }),
  },
  {
    title: 'Object Goal Navigation using Goal-Oriented Semantic Exploration', authors: 'Chaplot et al.', year: 2020, venue: 'NeurIPS', tags: ['objectnav', 'navigation'], status: 'done', rating: 4,
    summary: 'Semantic Exploration combines an episodic semantic map with an exploration policy guided by the target object. A strong baseline for ObjectNav.',
    link: 'https://arxiv.org/abs/2007.00643', createdAt: T0 - 22 * DAY,
    content: doc({
      intro: [P('The agent must find an object of a given category, such as a chair, in an environment it has never seen.')],
      method: [
        UL('An episodic semantic map is built from RGB-D observations.'),
        UL('An exploration policy picks a long-term goal on the map.'),
        UL('A local policy drives the agent toward that goal.'),
      ],
    }),
  },
  {
    title: 'A Gentle Introduction to Conformal Prediction and Distribution-Free Uncertainty Quantification', authors: 'Angelopoulos & Bates', year: 2021, venue: 'arXiv', tags: ['conformal-prediction', 'uncertainty'], status: 'reading', rating: 0,
    summary: 'A conformal prediction tutorial with code examples. Explains how to build prediction sets with coverage guarantees and no distributional assumptions.',
    link: 'https://arxiv.org/abs/2107.07511', createdAt: T0 - 9 * DAY,
    content: doc({
      intro: [P('Conformal prediction turns any model into one that outputs prediction sets with finite-sample coverage guarantees.')],
      method: [
        CALLOUT('Reading progress: up to split conformal. Next: the conditional coverage section.'),
        H3('Split conformal'),
        P('Hold out calibration data, compute a nonconformity score for each sample, then take a quantile of those scores.'),
        EQ('\\hat{q}=\\mathrm{Quantile}\\left(s_1,\\dots,s_n;\\ \\frac{\\lceil (n+1)(1-\\alpha)\\rceil}{n}\\right)'),
        EQ('\\mathcal{C}(X_{n+1})=\\{\\,y : s(X_{n+1},y)\\le \\hat{q}\\,\\}'),
      ],
    }),
  },
  {
    title: 'Kimera: from SLAM to Spatial Perception with 3D Dynamic Scene Graphs', authors: 'Rosinol et al.', year: 2021, venue: 'IJRR', tags: ['3d-scene-graph', 'slam'], status: 'want', rating: 0,
    summary: 'Builds a metric-semantic mesh and organizes it into a layered 3D dynamic scene graph, from objects up to rooms and buildings.',
    link: 'https://arxiv.org/abs/2101.06894', createdAt: T0 - 4 * DAY,
  },
  {
    title: 'Learning Transferable Visual Models From Natural Language Supervision', authors: 'Radford et al.', year: 2021, venue: 'ICML', tags: ['clip', 'vision-language'], status: 'want', rating: 0,
    summary: 'CLIP is trained contrastively on about 400 million image-text pairs, so it can classify zero-shot from class descriptions alone.',
    link: 'https://arxiv.org/abs/2103.00020', createdAt: T0 - 1 * DAY,
  },
].map((p) => ({ ...p, sample: true }));
