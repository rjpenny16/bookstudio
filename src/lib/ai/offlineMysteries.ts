import type { MysteryChapterOutput, MysteryPlanOutput } from "./tasks";

/**
 * Built-in murder mysteries for offline use: a complete case plan, every
 * chapter's story and the words behind each clue puzzle, and the solution.
 * Each case is written to pass the same fair-play checks a model's plan
 * must pass (see agent/mystery), so offline books are solvable from their
 * clues alone.
 */

export interface OfflineMystery {
  /** Topics this case suits best. */
  match: RegExp;
  plan: MysteryPlanOutput;
  /** Story and puzzle words per chapter, in plan order. */
  chapters: MysteryChapterOutput[];
  reveal: string;
}

const listed = (title: string, words: string[]) => ({ title, words, entries: [] });
const cw = (title: string, entries: [string, string][]) => ({ title, words: [], entries: entries.map(([answer, clue]) => ({ answer, clue })) });
const coded = (title: string) => ({ title, words: [], entries: [] });

const RAVENSCROFT: OfflineMystery = {
  match: /manor|country house|estate|mansion|castle|village|cozy|cosy|english|british|vintage|classic|1920|tea/i,
  plan: {
    caseTitle: "Death at Ravenscroft Manor",
    setting: "Ravenscroft Manor, a rambling stone house in the English countryside, on a wet autumn night in 1928.",
    premise:
      "Sir Edmund Ravenscroft is found dead in his locked study the morning after his seventieth birthday dinner, a glass of brandy at his elbow. The door was locked from the inside, every guest has an alibi, and the house is full of people who had a reason to want him gone.",
    victim: { name: "Sir Edmund Ravenscroft", description: "A wealthy, sharp-tongued collector of paintings who trusted almost no one." },
    sleuth: { name: "Inspector Clara Finch", description: "A patient county detective who notices what everyone else walks past." },
    suspects: [
      { name: "Margaret Ravenscroft", role: "Sir Edmund's niece and heir", motive: "She inherits the manor and is deep in debt.", alibi: "She says she played the piano in the drawing room until midnight.", secret: "She secretly sold her late mother's pearls to pay her debts and had them copied in paste." },
      { name: "Dr. Felix Hale", role: "The family doctor", motive: "Sir Edmund had threatened to expose his gambling debts.", alibi: "He says he drove home at ten o'clock.", secret: "He never drove home: his car broke down, and he hid that he stayed because of his gambling debts." },
      { name: "Agnes Pell", role: "The housekeeper of thirty years", motive: "She believed she was about to be cut out of the will.", alibi: "She says she was counting the silver in the kitchen all evening.", secret: "She has been writing to Sir Edmund's estranged son, which is why she was cut from the will." },
      { name: "Victor Lane", role: "A London art dealer and house guest", motive: "Sir Edmund had discovered that a painting Lane sold him was a forgery.", alibi: "He says he read alone in the library all night.", secret: "" },
      { name: "Thomas Briggs", role: "The gardener", motive: "Sir Edmund had shouted at him that morning and threatened to dismiss him.", alibi: "He says he was mending the greenhouse until dawn.", secret: "He lost his cottage last month and has been sleeping in the greenhouse, afraid of being dismissed." },
    ],
    culprit: "Victor Lane",
    motive: "Sir Edmund had proved that the landscape Victor Lane sold him was a forgery and had written to Scotland Yard; exposure would have ruined Lane.",
    method:
      "While the house listened to Margaret's piano, Lane slipped out of the library's garden door, forced the loose study window, poured poison into the brandy decanter Sir Edmund drank from every midnight, and climbed back out. In his hurry he pocketed the decanter's glass stopper and later pushed it down the side of the library armchair. Before dawn he burned Sir Edmund's letter to the police in the library grate.",
    crimeScene: "the study",
    timeOfDeath: "00:00",
    timeline: [
      { time: "20:00", who: "Sir Edmund Ravenscroft", where: "the dining room", doing: "boasts of his letter at dinner" },
      { time: "21:30", who: "Margaret Ravenscroft", where: "the drawing room", doing: "starts playing the piano" },
      { time: "21:30", who: "Victor Lane", where: "the library", doing: "settles in alone by the fire" },
      { time: "21:30", who: "Agnes Pell", where: "the kitchen", doing: "counts the silver with the cook" },
      { time: "21:30", who: "Thomas Briggs", where: "the greenhouse", doing: "mends the broken panes" },
      { time: "22:00", who: "Dr. Felix Hale", where: "the garage", doing: "finds his flat tire and fetches the chauffeur" },
      { time: "23:40", who: "Victor Lane", where: "the study", doing: "climbs in at the window and poisons the decanter" },
      { time: "23:55", who: "Victor Lane", where: "the library", doing: "back by the fire, the stopper in his pocket" },
      { time: "00:00", who: "Sir Edmund Ravenscroft", where: "the study", doing: "locks his door and drinks his brandy" },
      { time: "00:00", who: "Margaret Ravenscroft", where: "the drawing room", doing: "plays her last piece" },
      { time: "00:00", who: "Agnes Pell", where: "the kitchen", doing: "still counting with the cook" },
      { time: "00:00", who: "Thomas Briggs", where: "the greenhouse", doing: "seen by the cook's lamp" },
      { time: "00:00", who: "Dr. Felix Hale", where: "the garage", doing: "mending the wheel with the chauffeur" },
      { time: "00:00", who: "Victor Lane", where: "the library", doing: "alone" },
      { time: "01:00", who: "Agnes Pell", where: "the kitchen", doing: "writes the last ledger entry" },
      { time: "05:00", who: "Victor Lane", where: "the library", doing: "burns Sir Edmund's letter in the grate" },
    ],
    falseTheory: { suspect: "Agnes Pell", why: "A fresh codicil cut her out of the will days before the murder, and she stormed out when it was read." },
    finalProof: { answer: "SUITCASE", reveals: "The bottle of poison, wrapped in a paint rag, is hidden in the lining of Victor Lane's suitcase." },
    chapters: [
      {
        title: "A Birthday to Remember",
        summary: "The guests gather for Sir Edmund's seventieth birthday dinner. He boasts of a letter he has written and of the brandy he takes alone at midnight. Inspector Finch, an old acquaintance, notices how tense everyone is.",
        clues: [{ kind: "word-search", answer: "CHECK THE DECANTER", reveals: "The poison was in the brandy decanter in the study, not in the glass.", suspect: "", effect: "neutral", theme: "the dinner table", source: "Inspector Finch's list of everything on the dinner table, written up that night" }],
      },
      {
        title: "The Locked Study",
        summary: "Sir Edmund is found dead in his study, the door locked from inside. Finch finds the window latch broken from outside and a pair of muddy boots beneath the window.",
        clues: [
          { kind: "crossword", answer: "WINDOW", reveals: "Someone came and went through the study window; the locked door means nothing.", suspect: "", effect: "neutral", theme: "the study", source: "the inventory of the study Finch draws up when the body is found" },
          { kind: "word-scramble", answer: "BOOTS", reveals: "The gardener's muddy boots were found under the study window.", suspect: "Thomas Briggs", effect: "implicates", theme: "the garden", source: "the gardener's rain-smudged tool list, found in the potting shed" },
        ],
      },
      {
        title: "The Gardener's Story",
        summary: "Thomas Briggs admits the boots are his but swears he left them there in the afternoon. The cook remembers seeing a lamp in the greenhouse late that night.",
        clues: [{ kind: "cryptogram", answer: "THE COOK SAW BRIGGS IN THE GREENHOUSE AT MIDNIGHT", reveals: "Briggs was in the greenhouse at midnight, far from the study.", suspect: "Thomas Briggs", effect: "clears", theme: "the greenhouse", source: "Mrs. Dove's statement, which Finch copies in her private shorthand code" }],
      },
      {
        title: "Notes from the Piano",
        summary: "Margaret insists she never left the piano. Finch questions the guests who listened, and then reads Sir Edmund's will, which has a fresh addition.",
        clues: [
          { kind: "word-search", answer: "SHE NEVER STOPPED PLAYING", reveals: "Margaret played without a break until midnight, in front of witnesses.", suspect: "Margaret Ravenscroft", effect: "clears", theme: "the music room", source: "the guests' statements about the evening in the music room" },
          { kind: "crossword", answer: "CODICIL", reveals: "A new codicil to the will cut Agnes Pell out entirely.", suspect: "Agnes Pell", effect: "implicates", theme: "the will", source: "the solicitor's papers, read aloud in the morning room" },
        ],
      },
      {
        title: "Below Stairs",
        summary: "Agnes Pell is furious about the will but has proof of where she spent the night. Finch checks the kitchen accounts.",
        clues: [{ kind: "word-scramble", answer: "LEDGER", reveals: "The kitchen ledger shows Agnes counting silver with the cook until one in the morning.", suspect: "Agnes Pell", effect: "clears", theme: "the kitchen", source: "the kitchen accounts book Agnes hands over" }],
      },
      {
        title: "The Doctor's Car",
        summary: "A stable boy says Dr. Hale's car never left the drive. Hale finally admits why he stayed.",
        clues: [
          { kind: "cryptogram", answer: "THE DOCTORS CAR NEVER LEFT THE DRIVE", reveals: "Dr. Hale lied about driving home at ten.", suspect: "Dr. Felix Hale", effect: "implicates", theme: "the stables", source: "the stable boy's note, written in the code the stable lads use for betting tips" },
          { kind: "crossword", answer: "PUNCTURE", reveals: "Hale's car had a flat tire, and he spent the night in the garage with the chauffeur mending it.", suspect: "Dr. Felix Hale", effect: "clears", theme: "motor cars", source: "the chauffeur's motor log in the garage" },
        ],
      },
      {
        title: "The Gallery",
        summary: "Finch studies Sir Edmund's newest painting with a magnifying glass, then visits the library where Victor Lane spent the night.",
        clues: [
          { kind: "word-search", answer: "THE SIGNATURE IS FAKE", reveals: "The painting Victor Lane sold Sir Edmund is a forgery.", suspect: "Victor Lane", effect: "implicates", theme: "paintings", source: "the gallery catalogue Victor Lane gave Sir Edmund with the painting" },
          { kind: "word-scramble", answer: "ASHES", reveals: "Ashes of a burned letter lay in the library grate, where Lane sat all night.", suspect: "Victor Lane", effect: "implicates", theme: "the library", source: "the library shelf list Finch checks against the shelves" },
        ],
      },
      {
        title: "The Missing Stopper",
        summary: "The brandy decanter's glass stopper is missing. Finch searches the house and finds it somewhere it should never have been.",
        clues: [{ kind: "cryptogram", answer: "THE STOPPER WAS HIDDEN IN THE LIBRARY ARMCHAIR", reveals: "Whoever poisoned the decanter hid its stopper in the library armchair, Lane's seat all night.", suspect: "Victor Lane", effect: "implicates", theme: "the search", source: "Finch's search report, coded so the household can't read it over her shoulder" }],
      },
    ],
    solution:
      "The decanter and the broken window show the killer came in from the garden while the house was busy. Briggs, Margaret, Agnes and Dr. Hale were each seen elsewhere at midnight. Only Victor Lane had a reason to fear Sir Edmund's letter, and the letter's ashes and the decanter's stopper were both found in the library where he sat alone.",
  },
  chapters: [
    {
      story: `Rain had been falling on Ravenscroft Manor since noon, and by the time the soup was served it was drumming on the dining room windows like impatient fingers.

Sir Edmund Ravenscroft sat at the head of the long table, seventy years old that very day and determined that everyone should know it. "Seventy," he announced, raising his glass. "And I intend to see eighty, whatever some of you might wish."

Nobody laughed. Inspector Clara Finch, who had known Sir Edmund for twenty years and had come only because he insisted, watched the faces around the candles.

His niece Margaret smiled too brightly. Dr. Felix Hale studied his fork. Victor Lane, the art dealer up from London, admired the new landscape over the fireplace a little too loudly. At the sideboard, Agnes Pell the housekeeper set down a dish with a clatter, and through the window Clara glimpsed Thomas Briggs the gardener hurrying past with a lantern.

"I have written a letter today," Sir Edmund went on, "that will surprise one of my guests very much. It goes to London in the morning." He tapped the side of his nose. "And now, as always, I shall take my brandy alone at midnight. Nobody touches my decanter. Nobody."

Later, as the guests drifted to the drawing room, Clara lingered by the empty table. Something about the evening sat wrong with her, the way a picture hangs a fraction off true. She took out her notebook and wrote down every name.

The answer to what troubled her was hiding in plain sight, among the things on that table.`,
      puzzles: [listed("The Dinner Table", ["CANDLE", "NAPKIN", "SILVER", "GOBLET", "PLATTER", "SOUP", "LADLE", "TUREEN", "CRYSTAL", "TOAST", "DESSERT", "CLOTH"])],
    },
    {
      story: `The scream came at half past seven the next morning. Agnes Pell had knocked on the study door with Sir Edmund's tea, knocked again, and finally fetched the spare key.

Sir Edmund sat slumped in his leather chair, quite dead, a half-finished glass of brandy at his elbow. The door had been locked from the inside; the key was still in the lock.

"Locked in," said Dr. Hale, pale as paper. "Then he must have done it himself."

Clara Finch did not answer. She was looking at the window behind the desk. The curtains were drawn, but a thin cold draught stirred them. She crossed the room and drew them back.

The brass latch hung loose, its screws twisted half out of the frame, and fresh scratches marked the wood on the outside. Rainwater had pooled on the sill.

"Nobody needed the door," Clara said quietly. "They had another way in."

She leaned out into the wet morning. Below the window, in the flower bed, stood a pair of heavy boots, caked with mud and grass and very much like the ones she had seen hurrying past with a lantern the night before.

Briggs, the gardener, was nowhere to be seen.`,
      puzzles: [
        cw("The Study", [
          ["WINDOW", "It was forced, so the locked door meant nothing"],
          ["DESK", "Sir Edmund's writing table"],
          ["LAMP", "It lights the room after dark"],
          ["CURTAIN", "Drawn across the glass at night"],
          ["LATCH", "A small fastening on a door or window"],
          ["CARPET", "Soft covering on the study floor"],
          ["INKWELL", "Pot that holds a pen's ink"],
          ["CLOCK", "It ticks on the mantelpiece"],
          ["LEATHER", "Material of the old armchair"],
          ["BOOKCASE", "Shelves along the wall"],
        ]),
        listed("In the Garden", ["BORDER", "ROSES", "TROWEL", "SHOVEL", "TULIP", "COMPOST", "HEDGE", "IVY", "SEEDS", "WATERING"]),
      ],
    },
    {
      story: `They found Thomas Briggs in the potting shed, drinking cold tea out of a jam jar and looking as if he had not slept.

"Aye, they're my boots," he said, before Clara could ask. "I left them under that window yesterday afternoon. Sir Edmund came out and shouted at me for trampling his roses, and I was so angry I walked off in my socks." He looked at his feet. "Daft, I know."

"And last night?"

"In the greenhouse, mending the broken panes before the frost gets in. All night. The lamp was lit. Anyone could have seen it." He rubbed his face. "I sleep out there now, if you must know. Lost the cottage last month. Sir Edmund didn't know, and I'd sooner he never had."

Margaret sniffed. "Anyone could have lit a lamp and left it."

Clara went to find the cook, a round, calm woman named Mrs. Dove who had been up half the night with a pan of rising bread. Mrs. Dove listened to the question, wiped her hands on her apron, and said something that made Clara write it down twice, word for word.

She did not tell the others what it was. Some messages, she thought, are better kept in code until you are sure of them.`,
      puzzles: [coded("The Cook's Word")],
    },
    {
      story: `"I never left the piano," Margaret Ravenscroft said, and her chin came up. "Not once, Inspector. Ask anyone."

So Clara asked. The vicar, who had dined at the manor and stayed the night because of the rain, said he had dozed in the drawing room to the sound of Chopin. The vicar's sister said Margaret had played every piece she knew, twice. The maid who brought in the coffee at half past eleven said Miss Margaret had not even looked up.

All of them told the same story about where Margaret had been from nine until twelve. Clara put a neat line through one name in her notebook, though she noticed, when Margaret leaned into the lamplight, that the pearls at her throat were paste. Whatever Margaret was hiding, it was a debt, not a death.

That afternoon the family solicitor arrived, damp and flustered, with the will. He read it in the morning room. Most of it was what everyone expected: the manor to Margaret, the paintings to a museum, small gifts to the staff.

Then he cleared his throat. "There is an addition, dated last week, in Sir Edmund's own hand."

When he read it out, Agnes Pell stood up so fast her chair fell over, and walked out of the room without a word.`,
      puzzles: [
        listed("The Music Room", ["PIANO", "SONATA", "MELODY", "KEYS", "TEMPO", "CHORD", "WALTZ", "PEDAL", "HARMONY", "BENCH", "RHYTHM", "LULLABY"]),
        cw("The Will", [
          ["CODICIL", "An addition to a will, made later"],
          ["ESTATE", "Everything a person leaves behind"],
          ["HEIR", "One who inherits"],
          ["LAWYER", "Another name for a solicitor"],
          ["SIGNED", "Written with a name at the bottom"],
          ["WITNESS", "Someone who watches a signing"],
          ["LEGACY", "A gift left in a will"],
          ["SEAL", "Wax mark on an envelope"],
          ["DEED", "Paper proving who owns a house"],
          ["CLAUSE", "One part of a legal document"],
        ]),
      ],
    },
    {
      story: `Clara found Agnes Pell in the kitchen, scrubbing a copper pan as if it had personally offended her.

"Thirty years," Agnes said without turning round. "Thirty years I kept this house, and he crosses me out of his will with one codicil and a stroke of his pen. Because I wrote to his son, Inspector. Mr. Robert, in Canada, who he hasn't spoken to in ten years. He found my letters. Yes, Inspector, I was angry. I am angry now. But I did not kill him."

"Where were you last night?"

"Here. The silver had to be counted before the birthday things went back in the chest. Mrs. Dove helped me. We count every spoon twice and write it all down; Sir Edmund checked the book himself every month." She jerked her head towards a shelf. "It's all there."

Clara took down the heavy book and turned the pages. Columns of neat figures, two sets of initials, and beside each entry the time it was written, as Sir Edmund had always insisted.

The last entry of the night had been made long after the brandy hour.

Clara closed the book gently. "Thank you, Miss Pell," she said. "I'm sorry about the will."

For the first time, Agnes Pell's hands stopped moving.`,
      puzzles: [listed("The Kitchen", ["LADLE", "KETTLE", "PUDDING", "GRAVY", "OVEN", "BREAD", "PANTRY", "SPOON", "TEAPOT", "PICKLE"])],
    },
    {
      story: `The kitchen ledger had settled one question: at midnight Agnes Pell had been counting spoons, not pouring poison. It settled nothing else.

The stable boy, Jem, waited until the others had gone before he tugged Clara's sleeve.

"The doctor's car," he whispered. "He says he drove off at ten. He never. I was up with the grey mare all night, and that car sat in the drive till morning."

Clara found Dr. Hale in the conservatory, staring at the rain. She told him what Jem had said, and watched the color leave his face.

"Sir Edmund knew about my debts," he said at last. "He told me at dinner he would tell the whole county unless I paid him back by Christmas. I was frightened, Inspector. When I found out I couldn't go home, I didn't want anyone to know I'd stayed. It looked so bad."

"Why couldn't you go home?"

"I walked out to the car at ten and found it sitting low on one side. Barker, the chauffeur, took one look and fetched his lamp. We were in the garage with that wretched wheel until two in the morning. Barker will tell you. He swore at it the whole time."

Barker, when Clara found him, told her exactly that, with even more swearing.`,
      puzzles: [
        coded("The Stable Boy"),
        cw("Motor Cars", [
          ["PUNCTURE", "A hole that lets the air out of a tire"],
          ["ENGINE", "It makes the car go"],
          ["WHEEL", "There are four on a motor car"],
          ["BRAKE", "Pedal that slows you down"],
          ["SPANNER", "Tool for turning nuts"],
          ["GARAGE", "Where the car is kept"],
          ["PETROL", "Fuel for the tank"],
          ["BONNET", "Lid over the engine"],
          ["HORN", "It honks"],
          ["JACK", "It lifts a car off the ground"],
        ]),
      ],
    },
    {
      story: `A puncture. Of all the alibis in the house, Dr. Hale's had turned out to be a flat tire and a chauffeur's swearing. Clara crossed out another name.

The new landscape still hung over the dining room fireplace, a stormy sky above a river, all gold frame and dark varnish. Sir Edmund had paid a fortune for it only a month ago.

Clara borrowed a magnifying glass from the study and climbed onto a chair. She looked at the brushstrokes, at the cracks in the paint, and at last at the bottom right corner, where the painter had signed his name.

She looked for a long time. Then she climbed down, very thoughtful, and went to the library.

The library was where Victor Lane said he had spent the whole evening, reading alone by the fire. It was a long, warm room that smelled of leather and old paper, with a garden door at one end that opened onto the lawn. The fire had burned out. Clara knelt by the grate and stirred the grey remains with the poker.

Most of it was coal. But among the coal lay thin, curled flakes that had once been paper, and on one of them, when she held it to the light, she could just make out two words in Sir Edmund's spiky hand: "Scotland Yard."`,
      puzzles: [
        listed("Paintings", ["CANVAS", "EASEL", "BRUSH", "PALETTE", "FRAME", "OILS", "SKETCH", "PORTRAIT", "VARNISH", "GALLERY", "PIGMENT", "STUDIO"]),
        listed("The Library", ["ATLAS", "SHELF", "CHAPTER", "PAGES", "SPINE", "LAMP", "NOVEL", "POETRY", "GLOBE", "INDEX"]),
      ],
    },
    {
      story: `The ashes from the library grate lay folded in Clara's handkerchief, in her coat pocket, where she could feel them like a weight.

"The stopper," Clara said, standing in the study again. "Where is the stopper?"

The brandy decanter sat on its silver tray, cut glass gleaming. But its heavy crystal stopper, shaped like a teardrop, was gone. Agnes Pell swore it had been there at dinner; she had polished it herself.

"Someone took the stopper because it carried something," Clara said. "A smear of poison. A fingerprint. Or simply because they were in a hurry and it was in their hand."

She organized a search. Briggs took the garden and the flower beds. Barker and Jem took the stables and the garage. Agnes took the kitchen, the larder and every drawer upstairs, with Margaret holding the lamp. Dr. Hale, eager to help now that his secret was out, crawled under the dining table.

It was Clara herself who found it, an hour later, pushed deep down the side of a chair cushion, where a person sitting all evening might slide something without anyone noticing.

She held it up to the window. A faint brown stain clung to the glass.

Now she knew. Did you?`,
      puzzles: [coded("The Search")],
    },
  ],
  reveal: `Inspector Finch gathered everyone in the dining room that evening, beneath the stormy landscape that had started it all.

"Sir Edmund was not killed in a locked room," she began. "The first clue told us to check the decanter: the poison was in the brandy, waiting for the glass he always poured at midnight. The second showed us the window, forced from outside. Anyone in the house could have reached it through the garden."

She turned to the gardener. "Your boots lay under that window, Mr. Briggs, but the cook saw you in the greenhouse at midnight. Miss Ravenscroft, you never stopped playing, and half the house heard you. Miss Pell, the codicil gave you a reason, and for a day I believed it was you; but the ledger puts you in the kitchen until one, and your letters to Mr. Robert explain the will. And Doctor, your car never left the drive, but a puncture kept you and Barker in the garage until two."

Then she looked at the art dealer. "That leaves you, Mr. Lane. The signature on that painting is fake. Sir Edmund found out, and wrote to Scotland Yard. You burned his letter in the library grate; I found the ashes. And you hid the decanter's stopper in the library armchair, the chair you sat in all night. While we listened to the piano, you went out through the library's garden door, opened the study window, poisoned the brandy and came back, with the stopper still in your hand."

"And the last deduction told us where to look. The sergeant has just opened your suitcase, Mr. Lane. In its lining, wrapped in a paint rag, is a small brown bottle, and what is left in it matches the stain on the stopper."

Victor Lane said nothing for a long moment. Then he looked up at the painting and laughed, a short, bitter sound.

"It's a very good forgery," he said. "He should never have noticed."

The rain had stopped. Outside, for the first time in two days, the stars were out over Ravenscroft Manor.`,
};

const HARBOR: OfflineMystery = {
  match: /hotel|harbou?r|sea|seaside|coast|beach|ocean|island|lighthouse|ship|cruise|boat|fishing|port|resort|travel|train|summer/i,
  plan: {
    caseTitle: "Murder at the Harbor Hotel",
    setting: "The Harbor Hotel, a creaking seaside hotel on a rocky coast, during a summer storm in 1953.",
    premise:
      "Desmond Carrow, the owner of the Harbor Hotel, is found dead at the foot of the cellar stairs the night he refuses to sell. The storm has closed the coast road, so whoever did it is still inside, and every one of them has a story.",
    victim: { name: "Desmond Carrow", description: "The stubborn, charming owner of the Harbor Hotel, who had just changed his mind about selling it." },
    sleuth: { name: "Miss Ada Quill", description: "A retired schoolteacher and longtime guest with a memory like a filing cabinet." },
    suspects: [
      { name: "Lillian Carrow", role: "Desmond's wife", motive: "She feared he would sell the hotel she loves after all.", alibi: "She says she was at the front desk all evening.", secret: "Behind Desmond's back, she had written to Julian Marsh saying she would persuade him to sell." },
      { name: "Captain Roy Dunmore", role: "A retired sea captain and permanent guest", motive: "Desmond owed him a great deal of money.", alibi: "He says he watched the storm from the pier.", secret: "He has been betting his pension on the horses and owes money all along the coast." },
      { name: "Nora Tate", role: "The hotel's young chef", motive: "Desmond had accused her of stealing from the larder.", alibi: "She says she was baking in the kitchen all night.", secret: "She takes the hotel's leftover food to her sick grandmother, which Desmond took for theft." },
      { name: "Julian Marsh", role: "A property developer from the city", motive: "Desmond backed out of selling him the hotel that very evening.", alibi: "He says he was on a long telephone call in Room Seven.", secret: "" },
      { name: "Pip Larkin", role: "The bellboy", motive: "He was found with Desmond's gold pocket watch.", alibi: "He says he found the watch on the stairs.", secret: "He has been hiding a stray dog in the staff cupboard and slipping out to feed it." },
    ],
    culprit: "Julian Marsh",
    motive: "Julian Marsh had promised his investors the hotel; when Desmond tore up the sale contract at dinner, Marsh stood to lose everything.",
    method:
      "Marsh pretended to take a long telephone call in his room, then followed Desmond down to the cellar, where Desmond kept his papers, and argued with him at the top of the stairs. Desmond fell. Marsh tried to take the torn contract from his hand, but a scrap tore away and stayed in Desmond's fist, and the carbon copy paper Marsh had used to forge a new contract ended up in his wastebasket.",
    crimeScene: "the cellar",
    timeOfDeath: "22:30",
    timeline: [
      { time: "19:30", who: "Desmond Carrow", where: "the dining room", doing: "tears up the sale contract" },
      { time: "20:00", who: "Nora Tate", where: "the cellar", doing: "fetches butter, flour on her hands" },
      { time: "21:00", who: "Pip Larkin", where: "the cellar stairs", doing: "picks up the dropped pocket watch" },
      { time: "21:30", who: "Julian Marsh", where: "Room Seven", doing: "says he is taking a long telephone call" },
      { time: "22:00", who: "Desmond Carrow", where: "the front desk", doing: "asks his wife for the cellar key" },
      { time: "22:20", who: "Julian Marsh", where: "the cellar", doing: "follows Desmond down with a new contract" },
      { time: "22:30", who: "Desmond Carrow", where: "the cellar", doing: "falls from the top of the stairs" },
      { time: "22:30", who: "Julian Marsh", where: "the cellar", doing: "grabs at the torn contract" },
      { time: "22:30", who: "Lillian Carrow", where: "the front desk", doing: "signs in a stranded motorist" },
      { time: "22:30", who: "Captain Roy Dunmore", where: "the pier", doing: "waves to the harbor master" },
      { time: "22:30", who: "Nora Tate", where: "the kitchen", doing: "answers her bread timer" },
      { time: "22:30", who: "Pip Larkin", where: "the staff cupboard", doing: "feeds the stray dog" },
      { time: "22:45", who: "Julian Marsh", where: "Room Seven", doing: "drops the carbon paper in his wastebasket" },
      { time: "23:50", who: "Pip Larkin", where: "the cellar stairs", doing: "finds the body" },
    ],
    falseTheory: { suspect: "Nora Tate", why: "Flour on the cellar steps puts the chef there, and Desmond had just accused her of theft." },
    finalProof: { answer: "BRIEFCASE", reveals: "The forged contract, with Desmond's signature traced through carbon, is locked in Julian Marsh's briefcase." },
    chapters: [
      {
        title: "Storm Over the Harbor",
        summary: "The guests are cut off by a summer storm. At dinner, Desmond Carrow announces he will not sell the hotel after all, and tears the sale papers in half in front of Julian Marsh.",
        clues: [{ kind: "crossword", answer: "CONTRACT", reveals: "Desmond tore up the sale contract at dinner, in front of everyone.", suspect: "", effect: "neutral", theme: "the hotel", source: "the dinner seating plan and menu card Miss Quill kept" }],
      },
      {
        title: "The Cellar Stairs",
        summary: "Desmond is found at the foot of the cellar stairs, the lantern smashed beside him. Miss Quill notices something clutched in his hand.",
        clues: [{ kind: "word-search", answer: "A TORN PAGE IN HIS HAND", reveals: "Desmond died holding a torn scrap of a typed page.", suspect: "", effect: "neutral", theme: "the cellar", source: "Miss Quill's notes on the cellar, made by lantern light" }],
      },
      {
        title: "The Bellboy's Pocket",
        summary: "Desmond's gold pocket watch turns up in Pip Larkin's jacket, and the hotel turns on the boy.",
        clues: [{ kind: "word-scramble", answer: "WATCH", reveals: "Desmond's pocket watch was found on the bellboy.", suspect: "Pip Larkin", effect: "implicates", theme: "the hotel lobby", source: "the lost-property book at the front desk" }],
      },
      {
        title: "Lost and Found",
        summary: "Pip explains that he found the watch on the stairs at nine. Lillian remembers speaking to her husband long after that.",
        clues: [{ kind: "cryptogram", answer: "THE WATCH STOPPED AT NINE BUT DESMOND WAS ALIVE AT TEN", reveals: "Desmond was alive an hour after Pip picked up the watch.", suspect: "Pip Larkin", effect: "clears", theme: "the stairs", source: "Miss Quill's own notebook, kept in the code she used for her pupils' marks" }],
      },
      {
        title: "Captain's Watch",
        summary: "Captain Dunmore's money troubles come out, but so does a witness on the pier. Then Miss Quill notices white dust on the cellar steps.",
        clues: [
          { kind: "word-search", answer: "HARBOR MASTER SAW HIM", reveals: "The harbor master saw the Captain on the pier all evening.", suspect: "Captain Roy Dunmore", effect: "clears", theme: "the pier", source: "the harbor master's logbook, telephoned through once the line returns" },
          { kind: "crossword", answer: "FLOUR", reveals: "There was flour on the cellar steps, and only the chef works with flour.", suspect: "Nora Tate", effect: "implicates", theme: "the kitchen", source: "Miss Quill's sketch of the cellar steps and what lay on them" },
        ],
      },
      {
        title: "Flour on the Stairs",
        summary: "Nora Tate admits she went to the cellar for butter early in the evening, but her baking kept her in the kitchen the rest of the night.",
        clues: [{ kind: "word-scramble", answer: "TIMER", reveals: "Nora's kitchen timer rang every ten minutes all night, and the kitchen boy heard her answer it every time.", suspect: "Nora Tate", effect: "clears", theme: "baking", source: "the kitchen's baking schedule pinned by the range" }],
      },
      {
        title: "The Switchboard",
        summary: "Miss Quill checks the switchboard log and the guest register at the front desk.",
        clues: [
          { kind: "cryptogram", answer: "NO CALLS WERE PUT THROUGH TO ROOM SEVEN THAT NIGHT", reveals: "Julian Marsh's long telephone call never happened.", suspect: "Julian Marsh", effect: "implicates", theme: "the switchboard", source: "the switchboard log, written in Lillian's operator shorthand" },
          { kind: "crossword", answer: "REGISTER", reveals: "Lillian signed in late arrivals at the front desk all evening; the register shows her hand every quarter hour.", suspect: "Lillian Carrow", effect: "clears", theme: "the front desk", source: "the guest register at the front desk" },
        ],
      },
      {
        title: "Ink and Paper",
        summary: "Miss Quill searches the guests' wastebaskets and finds a match for the scrap in Desmond's hand.",
        clues: [{ kind: "word-scramble", answer: "CARBON", reveals: "Carbon copy paper in Room Seven's wastebasket carries the same typed lines as the scrap in Desmond's hand.", suspect: "Julian Marsh", effect: "implicates", theme: "the writing desk", source: "the list of what Pip found in each wastebasket" }],
      },
    ],
    solution:
      "The torn page shows Desmond died over the contract. Pip, the Captain, Nora and Lillian were each accounted for when he fell. Julian Marsh had the motive, his telephone alibi was false, and the carbon paper in his room matches the scrap in Desmond's hand.",
  },
  chapters: [
    {
      story: `The storm came in off the sea at teatime, and by dinner the coast road was a river and the Harbor Hotel was an island.

Miss Ada Quill, who had spent every August in Room Three for twenty-two years, rather enjoyed it. She liked the rattle of the windows, the smell of salt and wet wool, and the way a storm made strangers talk to each other.

Tonight, though, nobody was talking much. Desmond Carrow, the hotel's owner, stood at the head of the dining room, a sheaf of typed papers in his hand.

"I said I'd sell," he announced. "I've changed my mind." And he tore the papers clean in half.

Julian Marsh, the smooth young developer who had come down from the city to buy the place, went very still. Lillian Carrow put her hand to her mouth. At the corner table, old Captain Dunmore muttered something into his whisky. Nora Tate, the chef, stood frozen in the kitchen doorway, and Pip the bellboy nearly dropped a tray of glasses.

"That," said Julian Marsh quietly, "was a mistake."

Miss Quill made a note of it. She made a note of most things.`,
      puzzles: [
        cw("The Hotel", [
          ["CONTRACT", "Desmond tore it in half at dinner"],
          ["LOBBY", "Entrance hall with armchairs"],
          ["KEYS", "They hang on hooks behind the desk"],
          ["SUITE", "A set of rooms for a guest"],
          ["PORTER", "He carries the luggage"],
          ["BALCONY", "Platform outside an upstairs window"],
          ["LIFT", "It goes up and down between floors"],
          ["DINER", "A guest at the evening meal"],
          ["MENU", "List of the evening's dishes"],
          ["TOWEL", "Found folded on the bed"],
        ]),
      ],
    },
    {
      story: `Everyone had seen Desmond tear the contract in half at dinner. Nobody, it seemed, had seen much of him since.

It was Pip who found him, just before midnight, sent down to the cellar for another bottle of port.

Desmond Carrow lay at the foot of the steep stone steps, the cellar lantern smashed beside him. The doctor from the village could not get through the floods, so it was Miss Quill, who had nursed in the war, who knelt and confirmed what everyone already knew.

"He fell," said Julian Marsh from the top of the stairs. "Those steps are a death trap. I've said so all week."

"Perhaps," said Miss Quill.

She did not touch anything. She looked. The lantern had been dropped, not set down. One of Desmond's shoes had come off on the third step. And his right hand was closed tight, as if it were holding on to something that mattered very much.

Gently, she eased the fingers open.

She looked at what lay in his palm for a long moment, and then she stood up, brushed the dust from her skirt, and asked Lillian Carrow to telephone the police the moment the lines came back.`,
      puzzles: [listed("The Cellar", ["BARREL", "BOTTLE", "CORK", "LANTERN", "STEPS", "SHADOW", "DAMP", "CRATE", "VAULT", "CANDLE", "COBWEB", "SHELVES"])],
    },
    {
      story: `By breakfast, the whole hotel knew. Desmond's gold pocket watch, which he never let out of his sight, was missing.

By lunch, it had been found, in the pocket of Pip Larkin's spare jacket, hanging in the staff cupboard.

"I knew it," said Captain Dunmore, thumping the table. "Light-fingered, that boy. Always has been."

Pip, who was sixteen and looked younger, stood in the middle of the lobby with his ears burning. "I didn't take it," he said. "I didn't, Miss Quill. I found it."

Lillian Carrow would not look at him. Julian Marsh shook his head sadly, as though he had expected nothing better. Even Nora Tate, who was usually kind to Pip, stayed in the kitchen doorway with her arms folded.

Miss Quill sat in her usual armchair by the fireplace and watched them all. A watch in a pocket, she thought. It is very easy to put a watch in a pocket. It is much harder to explain why it is there.

"Sit down, Pip," she said. "Have a biscuit. And tell me exactly where and when."`,
      puzzles: [listed("The Hotel Lobby", ["WAITER", "ARMCHAIR", "TROLLEY", "COUNTER", "HOURS", "BELL", "CLOCK", "LUGGAGE", "PALM", "SOFA"])],
    },
    {
      story: `"It was on the cellar stairs," Pip said, through a mouthful of shortbread. "On the top step. I was going past at nine o'clock with the hot water bottles, and I saw it shining. The glass was cracked, and it had stopped. I put it in my jacket to give back to Mr. Carrow in the morning. Then he was dead, and I was frightened, and I didn't know what to do."

"Nine o'clock," said Miss Quill. "You're sure?"

"The watch said nine. It stopped when it fell, I suppose." He went pink. "And I didn't say before, because of the dog. There's a stray in the staff cupboard, miss. I feed it. Mr. Carrow would've thrown it out."

Miss Quill turned to Lillian Carrow, who had been listening from the desk with a face like stone.

"Mrs. Carrow. When did you last speak to your husband?"

Lillian frowned. "He came to the desk to ask for the cellar key. He was in a temper about that wretched sale. The grandfather clock was striking." She stopped. "It was striking ten."

Pip looked from one to the other, not yet understanding. But Miss Quill was already writing, slowly, in the small neat code she had used to keep her pupils' marks secret for forty years.`,
      puzzles: [coded("The Stopped Watch")],
    },
    {
      story: `Captain Roy Dunmore had lent Desmond Carrow a great deal of money over the years. Everyone knew it, because the Captain told everyone.

"Not a penny back," he growled, when Miss Quill raised it. "And before you hear it from the bookmaker in town, yes, I owe half the coast myself. The horses. My business." "And now I never will see it. Do you think I'd push a man down the stairs who owed me money? Use your head, woman."

"Where were you, Captain, between ten and midnight?"

"On the pier, watching the storm. Best storm in thirty years. The waves were coming right over the end."

"Alone?"

The Captain hesitated. "Old Haggerty was in his hut at the end of the pier. The harbor master. Waved to me a dozen times. He'll remember; he thinks I'm mad."

The telephone line came back that afternoon, crackling. Haggerty remembered perfectly, and said so at length.

Afterwards, Miss Quill went down to look at the cellar stairs again in the daylight. Halfway down, on the edge of a step, there was a smudge of something soft and white. She touched it with one fingertip and sniffed. Then she climbed the stairs and went, rather slowly, towards the kitchen.`,
      puzzles: [
        listed("The Pier", ["WAVES", "SEAGULL", "ROPE", "ANCHOR", "LIGHTHOUSE", "TIDE", "NETS", "PLANKS", "SPRAY", "BUOY", "HARPOON", "DRIFTWOOD"]),
        cw("The Kitchen", [
          ["FLOUR", "White powder on the cellar steps"],
          ["BUTTER", "Kept cool in the cellar"],
          ["APRON", "Worn to keep a cook's clothes clean"],
          ["OVEN", "Where the bread bakes"],
          ["WHISK", "Tool for beating eggs"],
          ["SAUCEPAN", "Pot with a long handle"],
          ["DOUGH", "It rises before baking"],
          ["PANTRY", "Cupboard for food"],
          ["SPOON", "Used for stirring"],
          ["RECIPE", "Instructions for a dish"],
        ]),
      ],
    },
    {
      story: `Nora Tate did not wait to be accused.

"It's flour," she said, the moment Miss Quill came through the kitchen door. "I know. I went down for butter. Mr. Carrow keeps the butter in the cellar because it's cooler, and I had flour all over my hands. It was eight o'clock, Miss Quill, before he ever went down there."

"He accused you of stealing from the larder last week."

Nora's eyes filled. "He did, and it wasn't true. The leftovers, the heels of the loaves, the soup nobody ordered: I take them to my gran on Sundays. She's poorly. He saw me with a basket and thought the worst, and I was going to leave at the end of the summer because of it. But I didn't hurt him." She pointed at the big black range, where three loaves sat cooling. "I was making the bread for the morning. Twelve loaves, all night, because of the storm and nobody able to get to the baker's. You have to turn them, and check them, and knock them back. I was never out of this room more than a minute."

At the scrubbed table, Sam, the kitchen boy, nodded so hard his cap fell off. "She was here the whole time, miss. Every time it went off, she was there."

"Every time what went off?" asked Miss Quill.`,
      puzzles: [listed("Baking", ["TART", "ICING", "MUFFIN", "ROLLS", "EGGS", "CRUST", "BATTER", "YEAST", "LOAF", "SCONE"])],
    },
    {
      story: `The kitchen timer had settled Nora Tate: it had rung every ten minutes all night, and every time she had been there to answer it.

The front desk of the Harbor Hotel was a fortress of polished wood, and behind it sat the switchboard: a board of little brass holes and cords that Lillian Carrow worked like a church organ.

"Every call in or out goes through here," she said, a little proudly. "And every one goes in the log. Desmond insisted. He said guests would try to cheat us on the trunk calls."

Miss Quill opened the log to the night of the storm. She ran her finger down the page twice, slowly, and then once more.

"Mr. Marsh told us he spent two hours on the telephone to his business partners in the city," she said. "In Room Seven. From half past nine."

Lillian went very pale. "Then the log would show it."

Miss Quill turned the book so she could see. Then she reached for the other great book on the desk, the guest register, where every arrival signed in. The storm had brought half a dozen stranded motorists in off the flooded road, one after another, all evening long.

"And you signed every one of them in yourself, Mrs. Carrow?"

"Every one," said Lillian. "There was no one else to do it." She hesitated. "Miss Quill, I wrote to Mr. Marsh last month. I told him I'd talk Desmond round to selling. I was tired. I never thought it would come to this."`,
      puzzles: [
        coded("The Switchboard"),
        cw("The Front Desk", [
          ["REGISTER", "Book every arriving guest signs"],
          ["BELL", "Ring it for service"],
          ["CLERK", "Person behind the counter"],
          ["LEDGER", "Book of accounts"],
          ["STAMP", "Stuck on a letter"],
          ["POSTCARD", "Picture sent home from holiday"],
          ["PENCIL", "Writing tool with a lead"],
          ["RECEIPT", "Proof that a bill was paid"],
          ["ROOMS", "There are twenty in the hotel"],
          ["ARRIVAL", "Coming in, as a new guest"],
        ]),
      ],
    },
    {
      story: `The guest register had cleared Lillian Carrow: her neat signature marched down the page every quarter of an hour, all through the evening.

The scrap of paper from Desmond's hand lay on Miss Quill's handkerchief: a torn corner of a typed page, with half a line of words and part of a signature. The rest of the contract, the pieces Desmond had torn at dinner, had vanished.

"Somebody wanted those pieces back very badly," she said to Pip, who had become her assistant. "And somebody, I think, has been typing."

The hotel had one typewriter, an ancient black machine in the writing room. Anybody could use it. Miss Quill sat down in front of it and studied the keys, and the ribbon, and the little wire basket beside it.

Then she sent Pip round the hotel, with Lillian Carrow's permission and a large basket, to empty every wastebasket on every floor.

They spread the contents on the writing room table: old letters, a newspaper, apple cores, a broken comb, a crumpled railway timetable. And, from the basket in Room Seven, folded small, a thin black sheet that left a smear on Miss Quill's fingers.

She held it up to the window, next to the scrap from Desmond's hand.

The lines matched, letter for letter. And now, she thought, you have everything I have.`,
      puzzles: [listed("The Writing Desk", ["CRAYON", "PAPER", "RIBBON", "LETTER", "ENVELOPE", "BLOTTER", "INKPOT", "NIB", "QUILL", "STATIONERY"])],
    },
  ],
  reveal: `The police launch arrived the next morning, as soon as the sea calmed. Miss Quill asked the sergeant, very politely, to wait ten minutes in the lobby while she explained.

"Desmond Carrow did not fall," she began. "He died holding a torn page, and a man does not hold on to paper when he falls by accident. He was holding on to it because someone was trying to take it from him."

She turned to Pip. "Pip found the watch at nine, on the top step, but Desmond was alive at ten, asking his wife for the cellar key. Captain, the harbor master saw you on the pier all evening. Nora, I'll admit the flour on the steps had me looking at you, but it was from your eight o'clock trip for butter; your timer rang every ten minutes all night and you answered every one. And Mrs. Carrow, the register shows your hand at the desk every quarter of an hour."

Then she looked at Julian Marsh. "You lost the most when Desmond tore up the contract at dinner. You told us you were on the telephone in Room Seven, but no calls were put through to Room Seven that night. You followed Desmond down to the cellar to get the contract back, or to make him sign a new one you had typed. He refused, you struggled at the top of the stairs, and he fell, with a piece of the page still in his fist. And you threw away the carbon paper from your new contract in your own wastebasket."

"And the final deduction told me where the proof would be: your briefcase. The sergeant has it open now. Inside is the new contract, with Desmond's signature traced through carbon, and the scrap from Desmond's hand fits its torn corner exactly."

Julian Marsh straightened his tie. "Circumstantial," he said. But his voice shook, and when the sergeant stepped forward, he did not run.

That evening, Lillian Carrow took down the For Sale sign that Desmond had never quite had the heart to hang, and Pip got his biscuits on a china plate.`,
};

export const OFFLINE_MYSTERIES: OfflineMystery[] = [RAVENSCROFT, HARBOR];

/** The case that suits a topic best (by its words, else alternating by a hash of the topic). */
export function offlineMystery(topic: string, hash: number): OfflineMystery {
  return OFFLINE_MYSTERIES.find((m) => m.match.test(topic)) ?? OFFLINE_MYSTERIES[hash % OFFLINE_MYSTERIES.length];
}

/** The case a plan came from, by its title (the chapter writer only sees the plan). */
export function mysteryByTitle(caseFile: string): OfflineMystery | undefined {
  return OFFLINE_MYSTERIES.find((m) => caseFile.includes(m.plan.caseTitle));
}
