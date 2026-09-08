# Arrange so the expression can be heard

For explicit group level, space and effects while preserving AIR, use the [production workflow](production.md). It uses the existing exact scene processors and does not claim model hearing.

A single air should hold attention and make musical sense on its own. Relational specificity may appear in its first breath: a withheld response, a playful interruption, an answer that settles closer, or a familiar contour recognized in a different register. Continue from an earlier artifact only when the moment calls for it.

## Give the ear a path

Before adding voices, decide what leads each section. Write accompaniment that leaves room for that line's register, attacks, and held notes. Distinguish the roles of bass foundation, harmonic support, counterline, pulse, and color. A color need not play in every bar; two melodies may alternate or answer instead of competing throughout a passage.

At a return, choose what has changed: the harmony beneath a preserved melody, the space between replies, a new body, or a different ending. Do not rely on volume and extra layers as the only means of development. Bring the piece to a deliberate close.

## When a person says “the middle is crowded”

Use `refrain inspect <file> --section <id> --json` to locate the passage and inspect each voice. Peak simultaneous authored notes, register overlap, sustained gates, and attack counts are clues, not a taste verdict. A high count may be an intended rich chord; a low count may still sound masked.

Choose the smallest musical change that addresses the heard problem while keeping the valued material:

- If the lead is obscured, lower supporting voice gain or segment dynamics and give its register room.
- If every line attacks together, stagger answers or thin the authored accompaniment. Preserve a requested drum pattern exactly.
- If held parts accumulate, shorten the appropriate segment gate or introduce a rest. Check sustains entering from the previous section.
- Use pan for separation, with a meaningful center. Global voice gain/pan affects every occurrence; segment expression can address a particular passage.
- Source expression and exact performance binding are different. Do not claim to have added EQ, reverb, compression, or automated mixing by adjusting `gainDb`, `pan`, or `gate`. Bus DSP requires an explicitly authored supported scene/binding, with its changed identity reported.

Compare the revised source and then the sealed artifacts. Listen at the same musical passage using the ordinary Canvas section jump. There is no synchronized A/B switch: separate previews are independent transports. Avoid a louder-version preference by distinguishing native level from explicitly audition-matched output.

Report the decision in musical terms, then the evidence: e.g. “the reply has more space; the accompaniment now rests between lead phrases; pitch and rhythm of the lead and drums are unchanged in the comparison.” State a listening improvement only when actually heard or reported, and keep whose judgment it was clear.
