# Reader's guide: Descartes, *A Discourse on the Method* as a worldview

`descartes-discourse-on-method.json` is the argument structure of Descartes'
*Discourse on the Method of Rightly Conducting the Reason, and Seeking Truth in
the Sciences* (1637), in John Veitch's translation (Project Gutenberg ebook 59),
rendered as a worldview-core file. It records what Descartes argued, not what is
true; nothing in it is an endorsement.

## What is in the file

- **Statements** are written in Descartes' first person: "I doubt", "I should
  obey the laws and customs of my country", "The brutes have not merely less
  reason than man but none at all". Descriptive claims have `mode: "is"`,
  resolutions, maxims and precepts have `mode: "ought"`; a decision Descartes
  reports having acted on (to travel, to settle in Holland, to speak only of a
  new world) is recorded as the resolution, with a note saying that he reports
  acting on it.
- **Arguments** record the inferences Descartes draws, or visibly relies on, in
  the text. An argument's `justification` paraphrases the reasoning in the
  paragraph it cites.
- **Citations.** Every statement and argument carries `meta.source`, a list of
  paragraph keys such as `IV.3` (Part IV, paragraph 3) into
  `sources/descartes-discourse-on-method.txt`, where each paragraph is tagged
  with its key. A statement's citations are the paragraphs where it is asserted
  or where an inference Descartes draws relies on it, the asserting paragraph
  first; a reconstructed link (below) adds no citation to its premises, since
  Descartes does not invoke them there. An argument's citations are the
  paragraphs where the inference is drawn, the primary one first.
- **Roles.** `meta.role` is an informal label (`observation`, `assumption`,
  `definition`, `rule`, `maxim`, `axiom`, `conclusion`) recording how the text
  presents the statement, not its position in the graph: a rule Descartes lays
  down keeps `role: rule` even where the file records the reasons he gives for
  it. The format defines no vocabulary and the tools ignore it. Three markers
  matter for reading:
  - a statement whose note begins **"Implicit"** is a hidden premise the text
    relies on without stating (its role is usually `assumption`);
  - an argument whose note begins **"Reconstructed link"** records an inference
    the editor supplied rather than one Descartes draws in the cited paragraph:
    a dependency between parts or paragraphs made explicit when the six
    per-part extractions were merged and reviewed (a premise Descartes states
    elsewhere and does not invoke at the paragraph where the inference is
    drawn), or a step the text states without reasoning. Its justification is
    the editor's reading, not Descartes' words;
  - a statement whose note ends **"used in no inference"** is something
    Descartes states alongside an argument as a contrast case, an occasion, an
    illustration or a concession. It is kept because it is part of what he
    says, but it is not a premise, since the format reads premises as jointly
    supporting the conclusion; the argument's note names it.
- **Order.** Statements are ordered by first appearance in the text (part, then
  paragraph); arguments likewise, by where the inference is drawn.

### Counts

| | |
|---|---|
| statements | 510 (425 `is`, 85 `ought`) |
| by part (first appearance) | I: 85, II: 67, III: 84, IV: 82, V: 88, VI: 104 |
| arguments | 268, of which 39 carry a "Reconstructed link" note (13 added at merge time to connect the parts, 1 inherited from the Part I extraction, 15 marked in the first review and 10 in the second because they take a premise Descartes does not invoke at the cited paragraph or draw a step the text leaves unargued) |
| foundations (no incoming argument) | 259 |
| cyclic strongly connected components | 1 (four statements: the Cartesian circle) |
| ungrounded statements (`lint well-founded`) | 0 |
| hidden premises marked "Implicit" | 17 (16 of them with `role: assumption`; 47 statements carry `role: assumption` in all) |
| statements in no argument (`lint unused`) | 17 |

```
$ worldview validate examples/descartes-discourse-on-method.json
examples/descartes-discourse-on-method.json: valid (510 statements, 268 arguments)
$ worldview lint well-founded examples/descartes-discourse-on-method.json
well-founded: all 510 statements are grounded in 259 foundation(s)
$ worldview stats examples/descartes-discourse-on-method.json
statements: 510 (425 is, 85 ought)
arguments: 268 (premises 1-11, mean 2.287; conclusions 1-5; 0 with no premises)
foundations: 259   terminals: 86   unused: 17   ungrounded: 0
cycles: 1 (largest 4, 4 statements in cycles)
longest chain of arguments: 23
most supporting: manners-of-men-show-contradiction (97), extravagant-customs-approved-by-great-nations (96), custom-and-example-no-ground-for-belief (95), modest-should-follow-their-betters (94), philosophers-have-held-every-absurdity (94)
most supported: publish-discourse-and-specimens (188), should-communicate-findings-to-public (144), i-progressed-more-than-books-alone-would-have-allowed (93), must-not-conceal-physics (89), mastery-of-nature-desirable (86)
```

The 259 foundations are Descartes' genuine starting points, not accidental
orphans: his observations (his education at I.6, the anatomy of the heart at
V.4, the ligature experiment at V.6, that no animal declares its thoughts at
V.7), the principles he adopts without argument (that nothing comes from
nothing, that thinking requires existing, that everyone is bound to promote the
general good of mankind), the definitions he sets down (reason is a universal
instrument), and the hidden premises the merge and the reviews surfaced. No
statement with `role: conclusion` is a foundation. Seventeen statements are
isolated, with neither incoming nor outgoing arguments; they are caveats,
concessions, contrast cases and illustrations Descartes states and does not use
as grounds (for instance `hard-to-tell-what-is-distinctly-conceived` at IV.3,
`world-likely-created-complete` at V.2, the concession that the Persians and
Chinese may be as judicious as ourselves at III.2, the concession that his
first meditations may not be acceptable to everyone at IV.1, that he is not
immoderately desirous of glory at VI.8, and the geometers' object that sets
the scene at IV.5) and are kept because they are part of what he says. Each
carries a note saying so.

## How the six parts connect

The six extractions were merged so that the Discourse reads as one graph rather
than six. Duplicated claims (the first precept, the equal distribution of good
sense, the resolve to sweep away all opinions, the criterion of truth, God's
existence and perfection, the distinction of mind and body) are single
statements with the union of their citations. The spine of cross-part
dependencies is:

- **I → II.** The Part I verdicts on the sciences (`philosophy-nothing-above-doubt`,
  `mathematics-certain-and-evident`, `other-sciences-borrow-principles-from-philosophy`,
  `nothing-solid-on-uncertain-foundations`) feed the observation that only
  mathematicians have found demonstrations (`only-mathematicians-demonstrate`),
  the decision to establish the principles of philosophy first
  (`establish-philosophy-first`), and, by a reconstructed link, the resolve to
  rebuild (`sweep-away-own-opinions-by-house-analogy`).
- **II → III.** The provisional morality is needed because the resolve to sweep
  away all opinions leaves one still having to act
  (`provisional-code-by-analogy-with-rebuilding` takes
  `sweep-away-all-my-opinions` jointly with `avoid-irresolution-in-action` and
  `live-as-happily-as-possible`). The practice of doubt during the travels
  (III.6) follows the first precept (`clear-reasoning-from-precept-and-aim`),
  and the nine-year delay (III.7) rests on `wait-for-maturity-before-philosophy`
  (II.13); both are reconstructed links. The Part I claim that men's practical
  reasoning holds more truth than a scholar's speculations (I.14) is what the
  hope of examining his opinions better among men (III.6) rests on.
- **I, II, III → IV.** IV.1 grounds the method of doubt
  (`reject-all-doubtful-as-false`) only in the aim of attending solely to the
  search for truth; the file adds, as a reconstructed link, that the method is
  the strict form of `precept-1-accept-only-the-evident` and of the Part I rule
  to reckon the merely probable as false. The aim itself
  (`search-for-truth-alone`) is linked, again by reconstruction, to the II.13
  resolve to establish the principles of philosophy first and to the III.6
  design of doubting only to find ground for assurance. IV.1 recalls the second
  maxim of the provisional morality only as the contrast the new procedure
  inverts, and the provisional code being in place (III.6) and the rumour that
  he had already completed the inquiry (III.7) are the occasion of the first
  meditations, not grounds of their aim; none of them is a premise, so nothing
  of the morality or the biography is upstream of the cogito. The doubt the
  method produces is what the cogito is drawn from (`doubt-from-method`,
  reconstructed), and the cogito is then accepted as first principle *by* the
  first precept (`adopt-cogito-as-first-principle`, reconstructed).
- **IV internal.** The cogito grounds the criterion of clear and distinct
  perception (IV.3); the criterion is used in the ontological argument for God
  (IV.5); God's existence and veracity are then said to make the criterion
  certain (IV.7). That is the cycle described below.
- **IV → V.** The criterion and God's perfection ground the laws of nature
  (`laws-from-gods-perfection`, `laws-indubitable`), and the proof that the
  laws would hold in any world God created (`laws-necessary-in-any-world`) is
  what lets the fable of a new world apply them (`chaos-to-heavens-and-earth`);
  from there the cosmology, the physiology, and the body-as-machine follow.
  `mind-distinct-from-body` and `i-am-thinking-substance` are what Part V means
  by "the soul", and `mind-would-exist-without-body` (IV.2) joins the Part V
  argument that the soul does not die with the body.
- **V internal.** The two tests that machines fail lead, through the comparison
  of animals with men, to `animals-have-no-reason`, and from there to the
  rational soul being created rather than educed from matter, independent of the
  body, and immortal.
- **III, V → VI.** The decision to devote his life to natural science for the
  sake of medicine specialises the Part III choice of occupation; the estimate
  of his physics in VI.2 rests on the chain of truths of Part V. Every decision
  of Part VI (to communicate findings, to withhold the physics, to publish the
  Discourse with specimens) rests on value premises about the good of mankind
  and the utility of science: the oughts `duty-promote-general-good`,
  `mastery-of-nature-desirable` and `cares-should-extend-to-posterity`, and the
  evaluative is-statement `health-first-blessing`. The duty of VI.2 bears on
  the physics itself (`must-not-conceal-physics`), which VI.4-8 then defer:
  publication is withheld during his lifetime and the duty discharged toward
  posterity by writing the results as if for publication; the tension is
  Descartes' own, and `publish-discourse-as-account-of-path` is where the file
  records how the Discourse with its specimens reconciles the two.

## The main argument chains

The trees below are the text output of `worldview rests-on`, each statement
expanded once; `[see above]` marks a repeat, `[depth limit]` a subtree cut off
by `--depth`.

### The cogito and the distinction of mind from body

The cogito rests on the method of doubt. IV.1 draws it from "whilst I thus
wished to think that all was false": the thinking whose existence is inferred
is the doubt the method produces, so `i-doubt` is concluded (by the
reconstructed link `doubt-from-method`) from the resolve to reject the doubtful
as false and the three suppositions it yields, and behind that resolve stand
the first precept, the Part I rule about the merely probable, and the II.13
resolve to establish the principles of philosophy first. The cogito's closure
is 53 statements and 22 arguments, of which the last two steps
(`doubt-is-thought`, `cogito-argument`) rest on the two premises Descartes sees
"very clearly": that to doubt is to think and that to think one must exist.
The mind-body distinction that follows it in IV.2 rests on three more
observations (what I can and cannot suppose away, and that without thought I
would have no reason to believe I existed) and one hidden premise,
`conceivability-reveals-essence`, which Descartes never states. IV.2 draws all
three consequences of the substance conclusion in one clause, so
`mind-body-distinction` yields three statements jointly: the mind is distinct
from the body, more easily known than it, and would exist without it. Shown to
depth 5; the subtree under `reject-all-doubtful-as-false` is the whole Part
I-II chain behind the method.

```
$ worldview rests-on examples/descartes-discourse-on-method.json mind-distinct-from-body --depth 5
mind-distinct-from-body: The 'I', that is, the mind by which I am what I am, is wholly distinct from the body.
  <- mind-body-distinction (jointly with mind-easier-to-know-than-body, mind-would-exist-without-body)
      i-am-thinking-substance: I am a substance whose whole essence or nature consists only in thinking.
        <- essence-is-thinking [argument from conceivability] (jointly with mind-needs-no-place-or-matter)
            can-suppose-no-body-no-world: I can suppose that I have no body and that there is no world and no place in which I exist.  [foundation]
            cannot-suppose-i-do-not-exist: I cannot suppose that I do not exist.  [foundation]
            cogito: I think, therefore I am: I exist.
              <- cogito-argument [modus ponens]
                  i-am-thinking: I am thinking; even my attempt to suppose that everything is false is itself an act of thought.
                    <- doubt-is-thought [instantiation]
                        i-doubt: I doubt: I am uncertain of the truth of many things.
                          <- doubt-from-method [application of rule]
                              reject-all-doubtful-as-false: I ought to reject as absolutely false every opinion in which I can imagine the least ground for doubt, to see whether anything wholly indubitable remains.  [depth limit]
                              suppose-nothing-as-senses-present: I suppose that nothing exists as the senses present it to us.  [depth limit]
                              reject-prior-demonstrations: I reject as false all the reasonings I had previously taken for demonstrations.  [depth limit]
                              suppose-waking-thoughts-no-truer-than-dreams: I suppose that everything that has ever entered my mind while awake has no more truth than the illusions of my dreams.  [depth limit]
                        doubting-is-thinking: To doubt is to think.  [foundation]
                  thinking-requires-existence: In order to think, it is necessary to exist.  [foundation]
            without-thought-no-reason-to-believe-i-exist: If I had merely ceased to think, I would have had no reason to believe that I existed, even if everything else I had ever imagined were real.  [foundation]
            conceivability-reveals-essence: What I can suppose myself to exist without does not belong to my essence; what I cannot suppose away while I exist is my whole essence.  [foundation]
      mind-needs-no-place-or-matter: In order to exist, I need no place and depend on no material thing.
        <- essence-is-thinking [argument from conceivability] (jointly with i-am-thinking-substance)
            can-suppose-no-body-no-world: I can suppose that I have no body and that there is no world and no place in which I exist.  [see above]
            cannot-suppose-i-do-not-exist: I cannot suppose that I do not exist.  [see above]
            cogito: I think, therefore I am: I exist.  [see above]
            without-thought-no-reason-to-believe-i-exist: If I had merely ceased to think, I would have had no reason to believe that I existed, even if everything else I had ever imagined were real.  [see above]
            conceivability-reveals-essence: What I can suppose myself to exist without does not belong to my essence; what I cannot suppose away while I exist is my whole essence.  [see above]

closure: 60 statements, 24 arguments
```

The method of doubt itself, one level down:

```
$ worldview rests-on examples/descartes-discourse-on-method.json reject-all-doubtful-as-false --depth 1
reject-all-doubtful-as-false: I ought to reject as absolutely false every opinion in which I can imagine the least ground for doubt, to see whether anything wholly indubitable remains.
  <- method-of-doubt [means-end reasoning]
      search-for-truth-alone: My aim in these meditations is solely the search for truth: to discover whether anything in my beliefs is wholly indubitable.  [depth limit]
      precept-1-accept-only-the-evident: I should accept nothing as true that I do not clearly know to be so, admitting into my judgments only what is presented so clearly and distinctly that I cannot doubt it.  [depth limit]
      merely-probable-nearly-false: Whatever is only probable should be reckoned as well-nigh false.  [depth limit]

closure: 31 statements, 12 arguments
```

### God's existence

Three arguments reach `god-exists`. The first two (from the source of the idea
of perfection, and from my own dependence) are free of the criterion; the third,
the ontological argument, uses it, and this is where the cycle enters. The
contrast cases IV.4 and IV.5 state alongside these arguments (the ideas of sky
and earth that need no source beyond myself; that geometry does not prove its
objects exist) are in the file as statements but are not premises. Shown to
depth 2; the closure of 72 statements is the cogito's closure plus the Part IV
axioms and observations, with nothing from the provisional morality of Part III.

```
$ worldview rests-on examples/descartes-discourse-on-method.json god-exists --depth 2
god-exists: God, a being that is wholly perfect and possesses every perfection of which I can form an idea, exists.  [cycle: clear-and-distinct-is-true, god-exists, god-has-all-perfections, geometry-certain-because-clearly-conceived]
  <- god-from-idea-of-perfection [elimination] (jointly with my-idea-of-perfection-comes-from-god)
      i-have-idea-of-more-perfect-being: I have in me the idea of something more perfect than myself.  [foundation]
      i-am-not-wholly-perfect: My being is not wholly perfect.
        <- imperfection-from-doubt [modus ponens]
            i-doubt: I doubt: I am uncertain of the truth of many things.  [depth limit]
            knowing-more-perfect-than-doubting: It is a greater perfection to know than to doubt.
      idea-source-is-nothing-self-or-other: Any idea I have was received either from nothing, from myself, or from some other nature.  [foundation]
      nothing-comes-from-nothing: It is manifestly impossible for anything to proceed from nothing.  [foundation]
      more-perfect-cannot-come-from-less-perfect: It is no less repugnant that the more perfect should be an effect of, or depend on, the less perfect than that something should proceed from nothing.  [foundation]
  <- god-from-my-dependence [modus tollens] (jointly with i-depend-on-god-for-all-i-possess)
      i-know-perfections-i-lack: I know of some perfections that I do not possess.
        <- perfections-i-lack
            i-have-idea-of-more-perfect-being: I have in me the idea of something more perfect than myself.  [see above]
            i-am-not-wholly-perfect: My being is not wholly perfect.  [see above]
      self-sufficient-being-could-give-itself-all-perfections: Had I existed alone and given myself the little perfection I possess, I could equally have given myself all the perfection I lack: infinity, eternity, immutability, omniscience, omnipotence.  [foundation]
  <- ontological-argument [analogy] (jointly with god-existence-as-certain-as-geometry)
      existence-contained-in-idea-of-perfect-being: Existence is comprised in the idea of a Perfect Being just as having angles equal to two right angles is comprised in the idea of a triangle, or even more clearly.  [foundation]
      geometry-certain-because-clearly-conceived: The great certainty accorded by common consent to geometrical demonstrations rests solely on their being clearly conceived according to my rule.  [cycle: clear-and-distinct-is-true, god-exists, god-has-all-perfections, geometry-certain-because-clearly-conceived]
        <- geometry-certainty-from-criterion [application of rule]
            clear-and-distinct-is-true: Whatever we conceive very clearly and distinctly is true.  [cycle: clear-and-distinct-is-true, god-exists, god-has-all-perfections, geometry-certain-because-clearly-conceived; depth limit]
      clear-and-distinct-is-true: Whatever we conceive very clearly and distinctly is true.  [cycle: clear-and-distinct-is-true, god-exists, god-has-all-perfections, geometry-certain-because-clearly-conceived; see above]

closure: 72 statements, 32 arguments
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
      passion-movements-are-not-speech: The natural movements that express the passions must not be confounded with speech.
        <- passion-movements-not-speech
            passion-movements-imitable-by-machines: The natural movements that indicate the passions can be imitated by machines as well as manifested by animals.
      brutes-have-no-hidden-language: The brutes do not, as some of the ancients thought, speak a language that we merely fail to understand.
        <- no-hidden-animal-language [modus tollens]
            animals-have-organs-analogous-to-ours: Animals are endowed with many organs analogous to ours.
            no-animal-declares-thoughts: No animal, however perfect or well circumstanced, can join words or signs to declare its thoughts.  [see above]
  <- ape-versus-child [modus tollens] (jointly with brute-soul-wholly-different-from-ours)
      little-reason-needed-and-inequality-within-species: Very little reason is needed to be able to speak, and within a species of animals, as among men, some individuals are more capable and more teachable than others.  [foundation]
      no-animal-declares-thoughts: No animal, however perfect or well circumstanced, can join words or signs to declare its thoughts.  [see above]
      no-man-lacks-language: No man is so dull and stupid, not even an idiot, that he cannot join words together to make his thoughts understood.  [see above]
  <- uneven-skill-shows-no-reason [reductio ad absurdum] (jointly with nature-acts-in-animals-by-organs)
      animal-skill-uneven: Many animals show more skill than we in certain actions yet none at all in many others.  [foundation]

closure: 14 statements, 9 arguments
```

From here `soul-not-educible-from-matter` (a reconstructed link: V.8 reports the
result as shown in the withheld treatise) takes
`machine-acts-from-organs-not-knowledge` and `reason-is-universal-instrument`
together with the Part IV account of the soul; `soul-independent` takes that
account together with `rational-soul-not-from-matter`, the comparison with the
brutes being offered in V.8 as an aid to comprehension rather than as a
premise; and the chain ends at `rational-soul-expressly-created` and
`soul-immortal`.

### The decision to publish

Three independent arguments support publishing the Discourse with its
specimens. The third, a reconstructed link, is what makes the decision rest on
the Part VI duty to communicate findings (itself resting on
`duty-promote-general-good`) and on the decision to withhold the physics. The
full closure of this statement is 188 statements, more than a third of the
file.

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

closure: 188 statements, 97 arguments
cycle: clear-and-distinct-is-true, god-exists, god-has-all-perfections, geometry-certain-because-clearly-conceived
```

## The cycle: the Cartesian circle

```
$ worldview sccs examples/descartes-discourse-on-method.json
cycle 1: clear-and-distinct-is-true, god-exists, god-has-all-perfections, geometry-certain-because-clearly-conceived
  internal arguments: god-nature-from-perfections, geometry-certainty-from-criterion
  boundary arguments: criterion-from-cogito, god-from-idea-of-perfection, god-from-my-dependence, god-lacks-doubt, god-not-composite, dependence-of-imperfect-natures, ontological-argument, all-certainty-rests-on-god, divine-guarantee, falsity-from-imperfection, distinct-ideas-in-sleep, dreams-do-not-undermine, reason-only-rule, ideas-contain-truth, chain-from-first-principles, laws-indubitable, laws-from-gods-perfection, laws-necessary-in-any-world
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
`god-exists`, `god-has-all-perfections`. Two of its arguments run entirely
inside it (`god-nature-from-perfections`, `geometry-certainty-from-criterion`);
the rest cross its boundary. Descartes even states the dependence in its own
words (`criterion-depends-on-god`, IV.7: the rule "is certain only because God
is or exists"). The format allows cycles by design and reports them as
structure; `lint well-founded` finds nothing ungrounded because both
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
| `what-constitutes-us-men-is-our-nature` | I.2 | the step from reason constituting us men to reason being a form, not an accident |
| `nothing-solid-on-uncertain-foundations` | I.10, I.13 | the bridge from insecure foundations to "nothing solid can be built"; also under the Part II resolve to rebuild |
| `disputed-implies-doubtful` | I.12 | the bridge from "still in dispute" to "nothing above doubt" |
| `states-are-towns-opinions-are-my-house` | II.2 | the analogy that licenses reforming one's own opinions but not the state |
| `inquiry-needs-freedom-from-interruption` | III.7 | the only reason given for the move to Holland |
| `foundations-must-be-open-to-judgement` | IV.1 | why the first meditations must be recounted despite their strangeness |
| `doubting-is-thinking` | IV.1 | the step from "I doubt" to "I think" (role `definition`) |
| `conceivability-reveals-essence` | IV.2 | the step from what I can and cannot suppose away to what I am |
| `idea-source-is-nothing-self-or-other` | IV.4 | the enumeration over which the first proof of God eliminates |
| `what-i-would-gladly-be-rid-of-is-imperfection` | IV.4 | the test by which doubt, inconstancy and sadness are excluded from God |
| `imperfection-implies-dependency` | IV.4 | the converse of the stated axiom, needed for "imperfect natures depend on God" |
| `answer-to-dream-doubt-must-rest-on-criterion` | IV.7 | why no answer to the dream doubt can avoid presupposing God |
| `everything-from-matter-or-created` | V.8 | the disjunction that turns "not from matter" into "expressly created" |
| `we-have-sensations-and-appetites` | V.8 | what the pilot-in-a-ship argument needs, together with the stated premise that a merely piloting soul could only move the members |
| `nothing-after-death-leads-from-virtue` | V.8 | why the brute-soul error is ranked next to atheism |
| `publish-nothing-possibly-harmful` | VI.1 | the rule that turns a fear of error into a decision to suspend publication |
| `french-reaches-unlearned-readers` | VI.11 | what the choice of French presupposes |

Other assumptions Descartes states but does not argue for, and which carry
weight in the graph (`role: assumption`):

- `universal-conviction-not-mistaken` (I.1): it is not likely that everyone is
  mistaken about their share of good sense. The opening argument of the book
  stands on this.
- `degrees-only-among-accidents-not-natures` (I.2): a scholastic doctrine adopted
  to make reason complete in each individual; `no-other-qualities-perfect-the-mind`
  (I.2) closes the enumeration by which he judges his own mind no better than
  the common run.
- `thinking-requires-existence` (IV.1, IV.3): seen "very clearly", never argued;
  the sole ground of the cogito's certainty.
- `one-known-truth-reveals-ground-of-certainty` (IV.3): the methodological
  premise that turns one certain proposition into a general criterion.
- `self-sufficient-being-could-give-itself-all-perfections` (IV.4): the
  counterfactual on which the second proof of God turns; it quietly assumes that
  a being able to give itself a perfection would have done so.
- `only-our-thoughts-are-fully-in-our-power`, `will-seeks-only-what-seems-attainable`
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
- `pilot-soul-could-only-move-members` (V.8): that a soul lodged in the body
  merely as a pilot could at most move its members; the stated half of the
  pilot-in-a-ship argument.
- `health-first-blessing` and `duty-promote-general-good` (VI.2, VI.4): the
  value premises behind mastering nature, choosing medicine, and publishing.

## Reproducing the checks

```
worldview validate examples/descartes-discourse-on-method.json
worldview stats examples/descartes-discourse-on-method.json
worldview foundations examples/descartes-discourse-on-method.json
worldview sccs examples/descartes-discourse-on-method.json
worldview lint all examples/descartes-discourse-on-method.json
worldview rests-on examples/descartes-discourse-on-method.json cogito
worldview rests-on examples/descartes-discourse-on-method.json reject-all-doubtful-as-false --depth 1
worldview rests-on examples/descartes-discourse-on-method.json god-exists --depth 2
worldview rests-on examples/descartes-discourse-on-method.json laws-observed-in-all-that-happens --depth 1
worldview supports examples/descartes-discourse-on-method.json good-sense-equally-distributed
worldview plan examples/descartes-discourse-on-method.json god-exists
worldview present examples/descartes-discourse-on-method.json cogito
```

## Editorial notes

- The Discourse draws the mind-body distinction (IV.2) *before* it states the
  criterion of truth (IV.3), from what can and cannot be supposed away. The file
  keeps that order: `mind-distinct-from-body` does not rest on
  `clear-and-distinct-is-true`. (The Meditations argue it differently.)
- Where the text gives several independent reasons for one conclusion they are
  separate arguments into it, never merged: three for `god-exists`, two for
  `devote-my-life-to-cultivating-reason`, two for
  `given-enough-time-to-the-ancients` (I.8: the travel analogy, and "Besides"
  the misrepresentations of fable and history), two each for
  `judge-beliefs-by-practice-not-speech`, `prefer-the-most-moderate-opinion` and
  `never-bind-my-future-judgement-by-promise` (III.2), two for
  `withhold-physics-during-lifetime` (the fear of error in VI.1 only suspends
  the printing, `suspend-publication-of-treatise`), three for
  `blood-circulates-perpetually`, three for `write-results-as-if-publishing`.
- Descartes' own account of the heart's motion (rarefaction by heat, V.5) and
  Harvey's circulation (V.6) are kept apart; the confirmations of V.7 are
  separate arguments into `heart-motion-mechanism`. V.7 offers the diffusion of
  heat, respiration, digestion and the animal spirits as further circumstances
  evincing the same cause; the file records those in the explanatory direction,
  out of `heart-motion-mechanism`, with a note on each saying so.
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
- A first review of the file against the text marked fifteen further arguments
  "Reconstructed link". Some take a premise from another part that Descartes
  does not invoke at the cited paragraph (`keep-faith-because-above-reason`
  takes the Part I reason for not examining the truths of faith;
  `sweep-away-own-opinions-by-house-analogy` takes the Part I principle that
  nothing solid rests on uncertain foundations; `devote-life-to-medicine` takes
  the Part III choice of occupation); the added citation appears in the
  argument's `meta.source`. Others draw a step within one part that the text
  states without reasoning (`turn-to-self-study`, `no-delay-forbids-irresolution`,
  `why-god-seems-hard-to-know`, `devote-life-from-inclination`), and two are
  new arguments the review added to record a reason Descartes gives elsewhere
  (`travel-hope-from-practical-truth`, `communicate-because-must-not-conceal`).
- The same review removed premises that the text offers only as a contrast
  case, an occasion, an illustration or a concession, since the format reads
  premises as jointly supporting the conclusion: the Persians and Chinese in
  the first maxim, the second maxim in the method of doubt (IV.1 recalls it
  only to set it aside), the moral assurance of body and world in IV.7, the
  ideas of sky and earth in the first proof of God, the geometers' object in
  IV.5, and the sun and chimaera examples in IV.8. Each such statement stays in
  the file with a note ending "used in no inference", and the argument's note
  names it.
- A second review applied the same tests more strictly. It marked ten more
  arguments "Reconstructed link": those that take a premise from another part
  or paragraph without the marker (`method-of-doubt`,
  `adopt-cogito-as-first-principle`, `why-french`,
  `proceed-slowly-from-danger-of-haste`, `follow-the-judicious-in-the-interim`),
  those that derive what the text asserts or reports as shown elsewhere
  (`perfections-i-lack`, `soul-not-educible-from-matter`, `machine-ape-test`,
  `language-test`), and one new argument, `doubt-from-method`, that makes the
  cogito rest on the doubt the method produces. It narrowed
  `search-for-truth-as-the-inquiry-into-principles` so that the provisional
  morality and the rumour of III.7 are no longer upstream of the cogito and of
  God (the closure of `god-exists` fell from 133 statements to 72), removed the
  one reconstructed argument that duplicated an existing chain
  (`cultivate-reason-because-judgement-is-virtue`), and dropped further
  concessions and asides from premise lists: that the first meditations may not
  be acceptable to everyone (IV.1), the care Descartes had always taken (VI.1),
  his indifference to glory (VI.8), the comparison with the brutes in the
  argument for the soul's independence (V.8), and the remark that animals
  resemble us in the functions that owe nothing to the soul (V.3). It added the
  premises the text states but the file had left in justifications only (the
  II.4 sentence on which class Descartes would have belonged to, that he cannot
  suppose that he does not exist at IV.2, the means-end premises of V.1 and
  V.2, the heated-vessel analogy of V.4, the arteries lying deeper in V.6, the
  pilot soul of V.8), split three cumulative arguments into independent ones,
  and replaced `laws-observed-in-all-that-happens` by `laws-hold-in-any-world`
  as the premise under the fable of a new world, since V.2 proves that the laws
  hold in any world God created precisely so that they can be applied inside
  the fable.
