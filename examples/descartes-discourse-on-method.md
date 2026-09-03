# Reader's guide: Descartes, *A Discourse on the Method* as a worldview

`descartes-discourse-on-method.json` is the argument structure of Descartes'
*Discourse on the Method of Rightly Conducting the Reason, and Seeking Truth in
the Sciences* (1637), in John Veitch's translation (Project Gutenberg ebook 59),
rendered as a worldview-core file. It records what Descartes argued, not what is
true; nothing in it is an endorsement.

## What is in the file

- **Statements** are written in Descartes' first person: "I doubt", "I should
  obey my country's laws and customs", "The brutes have not merely less reason
  than man but none at all". Descriptive claims have `mode: "is"`, resolutions,
  maxims and precepts have `mode: "ought"`.
- **Arguments** record the inferences Descartes draws, or visibly relies on, in
  the text. An argument's `justification` paraphrases the reasoning in the
  paragraph it cites.
- **Citations.** Every statement and argument carries `meta.source`, a list of
  paragraph keys such as `IV.3` (Part IV, paragraph 3) into
  `sources/descartes-discourse-on-method.txt`, where each paragraph is tagged
  with its key. A statement's citations are the paragraphs where it is asserted
  or relied on; an argument's are the paragraphs where the inference is drawn,
  the primary one first.
- **Roles.** `meta.role` is an informal label (`observation`, `assumption`,
  `definition`, `rule`, `maxim`, `axiom`, `conclusion`). The format defines no
  vocabulary and the tools ignore it. Two markers matter for reading:
  - a statement whose note begins **"Implicit"** is a hidden premise the text
    relies on without stating;
  - an argument whose note begins **"Reconstructed link"** was added when the
    six per-part extractions were merged, to make a dependency between parts
    explicit. Its justification is the editor's reading, not Descartes' words.
- **Order.** Statements are ordered by first appearance in the text (part, then
  paragraph); arguments likewise, by where the inference is drawn.

### Counts

| | |
|---|---|
| statements | 473 (401 `is`, 72 `ought`) |
| by part (first appearance) | I: 79, II: 61, III: 82, IV: 74, V: 77, VI: 100 |
| arguments | 249, of which 14 carry a "Reconstructed link" note (13 added at merge time to connect the parts, 1 inherited from the Part I extraction) |
| foundations (no incoming argument) | 235 |
| cyclic strongly connected components | 1 (four statements: the Cartesian circle) |
| ungrounded statements (`lint well-founded`) | 0 |
| hidden premises marked "Implicit" | 10 (36 statements carry `role: assumption` in all) |

```
$ worldview validate examples/descartes-discourse-on-method.json
examples/descartes-discourse-on-method.json: valid (473 statements, 249 arguments)
$ worldview lint well-founded examples/descartes-discourse-on-method.json
well-founded: all 473 statements are grounded in 235 foundation(s)
```

The 235 foundations are Descartes' genuine starting points, not accidental
orphans: his observations (his education at I.6, the anatomy of the heart at
V.4, the ligature experiment at V.6, that no animal declares its thoughts at
V.7), the principles he adopts without argument (that nothing comes from
nothing, that thinking requires existing, that everyone is bound to promote the
general good of mankind), the definitions he sets down (reason is a universal
instrument), and the hidden premises the merge surfaced. No statement with
`role: conclusion` is a foundation. Seven statements are isolated, with neither
incoming nor outgoing arguments; they are caveats Descartes states and does not
use (for instance `hard-to-tell-what-is-distinctly-conceived` at IV.3 and
`world-likely-created-complete` at V.2) and are kept because they are part of
what he says.

## How the six parts connect

The six extractions were merged so that the Discourse reads as one graph rather
than six. Duplicated claims (the first precept, the equal distribution of good
sense, the resolve to sweep away all opinions, the criterion of truth, God's
existence and perfection, the distinction of mind and body) are single
statements with the union of their citations. The spine of cross-part
dependencies is:

- **I → II.** The Part I verdicts on the sciences (`no-science-as-promised`,
  `philosophy-nothing-above-doubt`, `nothing-solid-on-uncertain-foundations`,
  `mathematics-certain-and-evident`) feed the Part II resolve to rebuild
  (`sweep-away-all-my-opinions`), the observation that only mathematicians have
  found demonstrations, and the decision to establish the principles of
  philosophy first.
- **II → III.** The provisional morality is needed because the resolve to sweep
  away all opinions leaves one still having to act
  (`provisional-code-by-analogy-with-rebuilding` takes
  `sweep-away-all-my-opinions` and `action-admits-no-delay` jointly). The choice
  to examine others' opinions oneself (III.5) rests on `must-use-own-reason`
  (II.4); the nine-year delay (III.7) rests on `wait-for-maturity-before-philosophy`
  (II.13).
- **II, III → IV.** The method of doubt (`reject-all-doubtful-as-false`) is the
  strict form of `precept-1-accept-only-the-evident` and of the Part I rule to
  reckon the merely probable as false, adopted once the second maxim of the
  provisional morality is set aside for the search for truth. The cogito is then
  accepted as first principle *by* the first precept.
- **IV internal.** The cogito grounds the criterion of clear and distinct
  perception (IV.3); the criterion is used in the ontological argument for God
  (IV.5); God's existence and veracity are then said to make the criterion
  certain (IV.7). That is the cycle described below.
- **IV → V.** The criterion and God's perfection ground the laws of nature
  (`laws-from-gods-perfection`, `laws-indubitable`), which ground the cosmology,
  the physiology, and the body-as-machine. `mind-distinct-from-body` and
  `i-am-thinking-substance` are what Part V means by "the soul", and
  `mind-would-exist-without-body` (IV.2) joins the Part V argument that the soul
  does not die with the body.
- **V internal.** The two tests that machines fail lead, through the comparison
  of animals with men, to `animals-have-no-reason`, and from there to the
  rational soul being created rather than educed from matter, independent of the
  body, and immortal.
- **III, V → VI.** The decision to devote his life to natural science for the
  sake of medicine specialises the Part III choice of occupation; the estimate
  of his physics in VI.2 rests on the chain of truths of Part V. Every decision
  of Part VI (to communicate findings, to withhold the physics, to publish the
  Discourse with specimens) rests on ought-statements about the good of mankind
  and the utility of science: `duty-promote-general-good`, `health-first-blessing`,
  `mastery-of-nature-desirable`, `cares-should-extend-to-posterity`.

## The main argument chains

The trees below are the text output of `worldview rests-on`, each statement
expanded once; `[see above]` marks a repeat, `[depth limit]` a subtree cut off
by `--depth`.

### The cogito and the distinction of mind from body

The cogito itself rests on only three foundations. The mind-body distinction
that follows it in IV.2 rests on one more observation and one hidden premise,
`conceivability-reveals-essence`, which Descartes never states.

```
$ worldview rests-on examples/descartes-discourse-on-method.json mind-distinct-from-body
mind-distinct-from-body: The 'I', that is, the mind by which I am what I am, is wholly distinct from the body.
  <- mind-body-distinction (jointly with mind-would-exist-without-body)
      i-am-thinking-substance: I am a substance whose whole essence or nature consists only in thinking.
        <- essence-is-thinking [argument from conceivability] (jointly with mind-needs-no-place-or-matter)
            can-suppose-no-body-no-world: I can suppose that I have no body and that there is no world and no place in which I exist.  [foundation]
            cogito: I think, therefore I am: I exist.
              <- cogito-argument [modus ponens]
                  i-am-thinking: I am thinking; even my attempt to suppose that everything is false is itself an act of thought.
                    <- doubt-is-thought [instantiation]
                        i-doubt: I doubt: I am uncertain of the truth of many things.  [foundation]
                        doubting-is-thinking: To doubt is to think.  [foundation]
                  thinking-requires-existence: In order to think, it is necessary to exist.  [foundation]
            without-thought-no-reason-to-believe-i-exist: If I had merely ceased to think, I would have had no reason to believe that I existed, even if everything else I had ever imagined were real.  [foundation]
            conceivability-reveals-essence: What I can suppose myself to exist without does not belong to my essence; what I cannot suppose away while I exist is my whole essence.  [foundation]
      mind-needs-no-place-or-matter: In order to exist, I need no place and depend on no material thing.
        <- essence-is-thinking [argument from conceivability] (jointly with i-am-thinking-substance)
            can-suppose-no-body-no-world: I can suppose that I have no body and that there is no world and no place in which I exist.  [see above]
            cogito: I think, therefore I am: I exist.  [see above]
            without-thought-no-reason-to-believe-i-exist: If I had merely ceased to think, I would have had no reason to believe that I existed, even if everything else I had ever imagined were real.  [see above]
            conceivability-reveals-essence: What I can suppose myself to exist without does not belong to my essence; what I cannot suppose away while I exist is my whole essence.  [see above]

closure: 10 statements, 4 arguments
```

### God's existence

Three arguments reach `god-exists`. The first two (from the source of the idea
of perfection, and from my own dependence) are free of the criterion; the third,
the ontological argument, uses it, and this is where the cycle enters. Shown to
depth 2.

```
$ worldview rests-on examples/descartes-discourse-on-method.json god-exists --depth 2
god-exists: God, a being that is wholly perfect and possesses every perfection of which I can form an idea, exists.  [cycle: clear-and-distinct-is-true, god-exists, god-has-all-perfections, geometry-certain-because-clearly-conceived]
  <- god-from-idea-of-perfection [elimination] (jointly with my-idea-of-perfection-comes-from-god)
      i-have-idea-of-more-perfect-being: I have in me the idea of something more perfect than myself.  [foundation]
      i-am-not-wholly-perfect: My being is not wholly perfect.
        <- imperfection-from-doubt [modus ponens]
            i-doubt: I doubt: I am uncertain of the truth of many things.
            knowing-more-perfect-than-doubting: It is a greater perfection to know than to doubt.
      idea-source-is-nothing-self-or-other: Any idea I have was received either from nothing, from myself, or from some other nature.  [foundation]
      nothing-comes-from-nothing: It is manifestly impossible for anything to proceed from nothing.  [foundation]
      more-perfect-cannot-come-from-less-perfect: It is no less repugnant that the more perfect should be an effect of, or depend on, the less perfect than that something should proceed from nothing.  [foundation]
      ideas-of-lesser-things-explicable-by-my-nature: My ideas of the sky, earth, light, heat and the like contain nothing superior to me; they could come from my own nature, or from its imperfection if false.  [foundation]
  <- god-from-my-dependence [modus tollens] (jointly with i-depend-on-god-for-all-i-possess)
      i-know-perfections-i-lack: I know of some perfections that I do not possess.
        <- perfections-i-lack
            i-have-idea-of-more-perfect-being: I have in me the idea of something more perfect than myself.  [see above]
            i-am-not-wholly-perfect: My being is not wholly perfect.  [see above]
      self-sufficient-being-could-give-itself-all-perfections: Had I existed alone and given myself the little perfection I possess, I could equally have given myself all the perfection I lack: infinity, eternity, immutability, omniscience, omnipotence.  [foundation]
  <- ontological-argument [analogy] (jointly with god-existence-as-certain-as-geometry)
      existence-contained-in-idea-of-perfect-being: Existence is comprised in the idea of a Perfect Being just as having angles equal to two right angles is comprised in the idea of a triangle, or even more clearly.  [foundation]
      geometry-does-not-prove-existence-of-its-objects: Nothing in a geometrical demonstration assures me that its object exists: I perceive that a triangle's angles equal two right angles without perceiving that any triangle exists.  [foundation]
      geometry-certain-because-clearly-conceived: The great certainty accorded by common consent to geometrical demonstrations rests solely on their being clearly conceived according to my rule.  [cycle: clear-and-distinct-is-true, god-exists, god-has-all-perfections, geometry-certain-because-clearly-conceived]
        <- geometry-certainty-from-criterion [application of rule]
            clear-and-distinct-is-true: Whatever we conceive very clearly and distinctly is true.  [cycle: clear-and-distinct-is-true, god-exists, god-has-all-perfections, geometry-certain-because-clearly-conceived; depth limit]
            geometers-object-is-extended-space: The object of the geometers is a continuous body or space indefinitely extended in length, breadth and depth, divisible into parts of various figures and sizes, and movable in every way.
      clear-and-distinct-is-true: Whatever we conceive very clearly and distinctly is true.  [cycle: clear-and-distinct-is-true, god-exists, god-has-all-perfections, geometry-certain-because-clearly-conceived; see above]

closure: 118 statements, 57 arguments
cycle: clear-and-distinct-is-true, god-exists, god-has-all-perfections, geometry-certain-because-clearly-conceived
```

### Animals lack reason

```
$ worldview rests-on examples/descartes-discourse-on-method.json animals-have-no-reason --depth 2
animals-have-no-reason: The brutes have not merely less reason than man but none at all.
  <- animals-fail-language-test
      machines-fail-two-tests-for-men: Machines with the form of our bodies, imitating our actions as far as morally possible, would still fail two most certain tests that show they are not really men.
        <- two-tests-for-men
            machine-cannot-arrange-words-to-reply: No machine could arrange words or signs variously so as to reply appositely to whatever is said in its presence, as even the dullest men can.  [depth limit]
            machine-acts-from-organs-not-knowledge: A machine, though it might do many things better than we, would fail in others, revealing that it acts not from knowledge but from the disposition of its organs.  [depth limit]
      no-man-lacks-language: No man is so dull and stupid, not even an idiot, that he cannot join words together to make his thoughts understood.  [foundation]
      no-animal-declares-thoughts: No animal, however perfect or well circumstanced, can join words or signs to declare its thoughts.  [foundation]
      animal-muteness-not-from-lack-of-organs: The inability of animals to speak does not arise from lack of organs.
        <- muteness-not-from-organs
            parrot-versus-deaf-mute: Magpies and parrots can utter words yet not show they understand them, while men born deaf and dumb, lacking the organs of speech, invent signs to make their thoughts known.
      animal-sounds-are-not-speech: The natural movements that express the passions are not speech, and the brutes do not speak a language we merely fail to understand.
        <- no-hidden-animal-language [modus tollens]
            animals-have-organs-analogous-to-ours: Animals are endowed with many organs analogous to ours.
            no-animal-declares-thoughts: No animal, however perfect or well circumstanced, can join words or signs to declare its thoughts.  [see above]
  <- ape-versus-child [modus tollens] (jointly with brute-soul-wholly-different-from-ours)
      little-reason-needed-and-inequality-within-species: Very little reason is needed to be able to speak, and within a species of animals, as among men, some individuals are more capable and more teachable than others.  [foundation]
      no-animal-declares-thoughts: No animal, however perfect or well circumstanced, can join words or signs to declare its thoughts.  [see above]
      no-man-lacks-language: No man is so dull and stupid, not even an idiot, that he cannot join words together to make his thoughts understood.  [see above]
  <- uneven-skill-shows-no-reason [reductio ad absurdum] (jointly with nature-acts-in-animals-by-organs)
      animal-skill-uneven: Many animals show more skill than we in certain actions yet none at all in many others.  [foundation]

closure: 12 statements, 8 arguments
```

From here `soul-not-educible-from-matter` takes `machine-acts-from-organs-not-knowledge`
and `reason-is-universal-instrument` together with the Part IV account of the
soul, and `soul-independent` takes `brute-soul-wholly-different-from-ours`; the
chain ends at `rational-soul-expressly-created` and `soul-immortal`.

### The decision to publish

Three independent arguments support publishing the Discourse with its
specimens. The third, a reconstructed link, is what makes the decision rest on
the Part VI duty to communicate findings (itself resting on
`duty-promote-general-good`) and on the decision to withhold the physics. The
full closure of this statement is 238 statements, half the file.

```
$ worldview rests-on examples/descartes-discourse-on-method.json publish-discourse-and-specimens --depth 1
publish-discourse-and-specimens: I should publish this discourse together with some particular specimens of my philosophy, giving the public an account of my doings and designs.
  <- publish-specimens-for-reputation
      silence-would-be-misread: If I published nothing, many who knew of my earlier intention to publish might imagine my reasons for refraining were less to my credit than they really are.
      should-avoid-being-ill-spoken-of: I am bound to do my best at least to save myself from being ill spoken of.  [depth limit]
      specimens-avoid-controversy: I can select matters that provoke little controversy and expound no more of my principles than I wish, yet show clearly what I can and cannot accomplish in the sciences.
  <- publish-specimens-to-enable-help
      experiments-delay-my-design: My design of self-instruction suffers daily more delay for want of the countless experiments I need, which I cannot make without the assistance of others.
      duty-to-self-to-inform-helpers: I owe it to myself not to give posterity ground to reproach me that things could have been left far more perfect had I made known how they might have helped.
      specimens-avoid-controversy: I can select matters that provoke little controversy and expound no more of my principles than I wish, yet show clearly what I can and cannot accomplish in the sciences.  [see above]
  <- publish-discourse-as-account-of-path
      should-describe-my-path-for-others-to-judge: I should describe the paths I have followed, so that each reader may judge them for himself and the general opinion of them becomes a new aid to my instruction.  [depth limit]
      should-communicate-findings-to-public: I ought to communicate to the public all the little I have found, and incite men of superior genius to contribute experiments and discoveries of their own.  [depth limit]
      withhold-physics-during-lifetime: I should not publish during my lifetime my treatise on physics, nor any work so general that the principles of my physics could be understood from it.  [depth limit]
      specimens-avoid-controversy: I can select matters that provoke little controversy and expound no more of my principles than I wish, yet show clearly what I can and cannot accomplish in the sciences.  [see above]

closure: 238 statements, 125 arguments
cycle: clear-and-distinct-is-true, god-exists, god-has-all-perfections, geometry-certain-because-clearly-conceived
```

## The cycle: the Cartesian circle

```
$ worldview sccs examples/descartes-discourse-on-method.json
cycle 1: clear-and-distinct-is-true, god-exists, god-has-all-perfections, geometry-certain-because-clearly-conceived
  boundary arguments: criterion-from-cogito, god-from-idea-of-perfection, god-from-my-dependence, god-nature-from-perfections, god-lacks-doubt, god-not-composite, imperfect-natures-depend-on-god-arg, geometry-certainty-from-criterion, ontological-argument, all-certainty-rests-on-god, body-less-certain-than-god, divine-guarantee, distinct-ideas-in-sleep, dreams-do-not-undermine, reason-only-rule, ideas-contain-truth, chain-from-first-principles, laws-indubitable, laws-from-gods-perfection, laws-necessary-in-any-world
```

The text supports both directions and the file records both:

- `criterion-from-cogito` (IV.3): the cogito is certain only because I see
  clearly that to think one must exist, so whatever is clearly and distinctly
  conceived is true.
- `geometry-certainty-from-criterion` and `ontological-argument` (IV.5): the
  certainty of geometry rests on clear conception according to that rule, and
  existence is contained in the idea of a Perfect Being as clearly as the
  angle-sum is contained in the idea of a triangle, so God exists at least as
  certainly as any geometrical demonstration.
- `god-nature-from-perfections` (IV.4) and `divine-guarantee` (IV.7): God has
  every perfection, falsity cannot proceed from God, all that is real in our
  ideas comes from him, so clear and distinct ideas are true.

The component is `clear-and-distinct-is-true`, `geometry-certain-because-clearly-conceived`,
`god-exists`, `god-has-all-perfections`. Descartes even states the dependence in
its own words (`criterion-depends-on-god`, IV.7: the rule "is certain only
because God is or exists"). The format allows cycles by design and reports them
as structure; `lint well-founded` finds nothing ungrounded because both
`clear-and-distinct-is-true` (via the cogito) and `god-exists` (via the two
IV.4 arguments) also have non-circular support. Everything downstream of the
criterion, including the whole physics of Part V, rests on this component.

Descartes denies a *different* circle at VI.10 (`not-a-circle`): reasoning from
causes to effects and back in the Dioptrics and Meteorics. That one is not in
the file as a cycle because the essays' contents are not extracted.

## Hidden assumptions surfaced

Statements the text relies on without stating (note begins "Implicit"):

| id | where | what it does |
|---|---|---|
| `states-are-towns-opinions-are-my-house` | II.2 | the analogy that licenses reforming one's own opinions but not the state |
| `the-inquiry-needs-freedom-from-interruption` | III.7 | the only reason given for the move to Holland |
| `doubting-is-thinking` | IV.1 | the step from "I doubt" to "I think" |
| `conceivability-reveals-essence` | IV.2 | the step from what I can suppose away to what I am |
| `idea-source-is-nothing-self-or-other` | IV.4 | the enumeration over which the first proof of God eliminates |
| `everything-from-matter-or-created` | V.8 | the disjunction that turns "not from matter" into "expressly created" |
| `we-have-sensations-and-appetites` | V.8 | what the pilot-in-a-ship argument needs |
| `nothing-after-death-leads-from-virtue` | V.8 | why the brute-soul error is ranked next to atheism |
| `publish-nothing-possibly-harmful` | VI.1 | the rule that turns a fear of error into a decision not to publish |
| `french-reaches-unlearned-readers` | VI.11 | what the choice of French presupposes |

Other assumptions Descartes states but does not argue for, and which carry
weight in the graph (`role: assumption`):

- `universal-conviction-not-mistaken` (I.1): it is not likely that everyone is
  mistaken about their share of good sense. The opening argument of the book
  stands on this.
- `degrees-only-among-accidents-not-natures` (I.2): a scholastic doctrine adopted
  to make reason complete in each individual.
- `may-judge-others-by-myself` (I.6): the licence that lets his own education
  stand for everyone's, so that "there is no science of the kind promised".
- `disputed-implies-doubtful` (I.12) and `nothing-solid-on-uncertain-foundations`
  (I.10, I.13): the two bridges from "philosophy is disputed" to "nothing solid
  can be built on it", and from there to rebuilding from the foundations.
- `thinking-requires-existence` (IV.1, IV.3): seen "very clearly", never argued;
  the sole ground of the cogito's certainty.
- `one-known-truth-reveals-ground-of-certainty` (IV.3): the methodological
  premise that turns one certain proposition into a general criterion.
- `self-sufficient-being-could-give-itself-all-perfections` (IV.4): the
  counterfactual on which the second proof of God turns; it quietly assumes that
  a being able to give itself a perfection would have done so.
- `only-our-thoughts-are-fully-in-our-power`, `the-will-seeks-only-what-seems-attainable`
  (III.4) and `we-seek-or-shun-only-as-the-understanding-judges` (III.5): the
  Stoic and intellectualist premises under the third maxim and under "right
  judgement suffices for right action".
- `expediency-favours-conforming-to-those-i-live-among` (III.2) and
  `live-as-happily-as-possible` (III.1): the practical ends of the provisional
  code.
- `mechanics-same-as-nature` (V.7): stated in passing; it underwrites the whole
  mechanical treatment of the body.
- `conservation-same-as-creation` (V.2): cited as theological consensus; the
  file adds a reconstructed link from IV.4's continuous dependence.
- `health-first-blessing` and `duty-promote-general-good` (VI.2, VI.4): the
  value premises behind mastering nature, choosing medicine, and publishing.

## Reproducing the checks

```
worldview validate examples/descartes-discourse-on-method.json
worldview foundations examples/descartes-discourse-on-method.json
worldview sccs examples/descartes-discourse-on-method.json
worldview lint well-founded examples/descartes-discourse-on-method.json
worldview rests-on examples/descartes-discourse-on-method.json cogito
worldview rests-on examples/descartes-discourse-on-method.json god-exists --depth 2
worldview rests-on examples/descartes-discourse-on-method.json laws-observed-in-all-that-happens --depth 1
worldview supports examples/descartes-discourse-on-method.json good-sense-equally-distributed
```

## Editorial notes

- The Discourse draws the mind-body distinction (IV.2) *before* it states the
  criterion of truth (IV.3), from what can and cannot be supposed away. The file
  keeps that order: `mind-distinct-from-body` does not rest on
  `clear-and-distinct-is-true`. (The Meditations argue it differently.)
- Where the text gives several independent reasons for one conclusion they are
  separate arguments into it, never merged: three for `god-exists`, three for
  `devote-my-life-to-cultivating-reason`, three for
  `withhold-physics-during-lifetime`, three for `blood-circulates-perpetually`.
- Descartes' own account of the heart's motion (rarefaction by heat, V.5) and
  Harvey's circulation (V.6) are kept apart; the confirmations of V.7 are
  separate arguments into `heart-motion-mechanism`.
- The thirteen arguments added at merge time, each marked "Reconstructed link"
  in its note, are: `search-for-truth-as-the-inquiry-into-principles` (II, III → IV),
  `only-mathematicians-demonstrate` (I → II), `method-exercised-during-travels`
  (II → III), `satisfaction-from-exercising-reason` (II → III),
  `fruits-of-the-method` (III → I), `fallibility-from-modest-estimate-of-my-mind`
  (I → IV), `continuous-dependence-grounds-conservation` (IV → V),
  `physics-from-chain-of-truths` (V → VI), `mind-dependence-from-union-with-body`
  (V → VI), `precept-in-practice` (II, IV → VI), `care-from-precept-and-rule`
  (II → VI), `publish-discourse-as-account-of-path` (I, VI → VI) and
  `no-promise-from-uncertain-means` (III, VI → VI). One more,
  `false-sciences-already-known`, was already marked in the Part I extraction.
  Several existing arguments were also given an additional premise from another
  part (for example `method-of-doubt` takes `maxim-2-be-firm-and-resolute` and
  `merely-probable-nearly-false`, and `keep-faith-because-above-reason` takes the
  Part I reason for not examining the truths of faith); the added citation
  appears in the argument's `meta.source`.
