-- M1 do cronograma (OK do mantenedor, 19/07/2026): TRILHA-BASE por nível,
-- semeada dos Academic Plans oficiais da Flexge (docs/research/flexge/*.pdf,
-- extraídos por pipeline Sonnet→validação Fable em 20/07/2026). A trilha é o
-- padrão-ouro do que cobrir por nível; o plano do aluno (M2) nasce copiando-a
-- e personalizando com o briefing. Conteúdo estável: edição futura será RPC
-- admin (M2) — nesta migration, só leitura.

create table curriculum_tracks (
  id uuid primary key default gen_random_uuid(),
  level text not null unique,
  source text not null default 'flexge-academic-plan',
  functions_of_language jsonb not null default '[]'::jsonb,
  grammar jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
comment on table curriculum_tracks is
  'Trilha-base por nível (Pre A1→C2), fonte: Academic Plans da Flexge. Leitura para todos os papéis logados; escrita nenhuma (seed via migration; edição futura por RPC admin).';

create table curriculum_topics (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references curriculum_tracks(id),
  position int not null,
  title text not null,
  educational_goals jsonb not null default '[]'::jsonb,
  functions_of_language jsonb not null default '[]'::jsonb,
  vocabulary text,
  unique (track_id, position)
);
comment on table curriculum_topics is
  'Módulos ordenados de cada trilha (Module N dos Academic Plans).';

alter table curriculum_tracks enable row level security;
alter table curriculum_topics enable row level security;
create policy curriculum_tracks_read on curriculum_tracks
  for select to authenticated using (true);
create policy curriculum_topics_read on curriculum_topics
  for select to authenticated using (true);
grant select on curriculum_tracks, curriculum_topics to anon, authenticated, service_role;
revoke insert, update, delete, truncate on curriculum_tracks, curriculum_topics from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Seed (conteúdo literal dos PDFs)
-- ---------------------------------------------------------------------------

insert into curriculum_tracks (level, functions_of_language, grammar)
values ('Pre A1', '["Greetings.", "Giving personal information.", "Understanding and using numbers.", "Asking for basic personal information.", "Buying and ordering food.", "Responding to simple questions with short answers."]'::jsonb, '["To be Present Tense, affirmative form.", "To be Present Tense, negative form.", "Subject pronouns", "Possessive adjectives", "Demonstrative pronouns.", "Definite and indefinite articles.", "Present tense – affirmative form.", "Present tense negative form.", "Wh- questions.", "Short answers."]'::jsonb);
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 1, 'Let''s practice English!', '["Teach the first words in English", "Teach the Verb to Be, in the Present Tense, Affirmative and Negative forms.", "Teach Personal Pronouns (Subject)."]'::jsonb, '["Teach how to understand and express basic personal information."]'::jsonb, 'High frequency words, Family members, objects, countries, colors, numbers, adjectives and basic action verbs.'
from curriculum_tracks where level = 'Pre A1';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 2, 'More about us', '["Teach the Adjective Pronouns.", "Teach the difference between the articles A, An e and The, and the Demonstrative Pronouns."]'::jsonb, '["Reinforce how to understand and express basic personal information.", "Teach how to describe the positions of things and people at a basic level.", "Teach how to talk about people and their belongings."]'::jsonb, 'The alphabet, High frequency words, Family members, objects, countries, colors, numbers, adjectives and basic action verbs.'
from curriculum_tracks where level = 'Pre A1';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 3, 'Greetings and Introductions', '["Teach Greetings and Giving Personal Information.", "Teach the Wh- Questions (What, When, Who, Where, How, Why)."]'::jsonb, '["Teach how to understand and express basic personal information.", "Teach simple day to day interactions.", "Teach how to ask and understand simple questions."]'::jsonb, 'High frequency words, greetings and farewells, family members, objects, countries, colors, professions, locations, time expressions, numbers, adjectives and basic action verbs.'
from curriculum_tracks where level = 'Pre A1';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 4, 'How many meals do you eat per day?', '["Practice asking for information.", "Practicing responding to simple questions with short answers."]'::jsonb, '["Reinforce simple day to day interactions.", "Reinforce how to understand and express basic personal information.", "Reinforce how to ask and understand simple questions."]'::jsonb, 'High frequency words, greetings and farewells, family members, objects, countries, colors, professions, locations, time expressions, numbers, adjectives and basic action verbs.'
from curriculum_tracks where level = 'Pre A1';
-- ⚠️ A1: Module list on the overview page (page 3) titles Module 4 as "Natural Wonders and how to travel to these places" (no question mark), while the detail heading on page 4 reads "Module 4 - Natural Wonders and how to travel to these places?" (with question mark). Used the detail-page title verbatim.
-- ⚠️ A1: No 'Vocabulary' section appears for any module in this PDF (unlike the Pre-A1 plan); 'vocabulary' left as an empty string for all modules.

insert into curriculum_tracks (level, functions_of_language, grammar)
values ('A1', '["Giving more detailed personal information.", "Telling the time.", "Understanding and using prices.", "Giving and asking for directions.", "Talking about routines, the duration and frequency of activities.", "Giving opinions, likes and dislikes.", "Asking for permission.", "Talking about past experiences.", "Talking about future arrangements.", "Describing people, places.", "Season."]'::jsonb, '["To be all forms. Personal and Object pronouns. Adjective Pronouns: common and demonstrative. Definite and indefinite articles.", "Plural forms of nouns. Possessive adjectives. Possessive \"s\" Genitive Case. Common prepositions in/on/at/from/to.", "Present simple all forms. Prepositions of time. Prepositions of place.", "There is/are all forms. Present continuous. Past Simple. Can.", "Future Plans - Going to.", "To x With."]'::jsonb);
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 1, 'Family Life', '["Teach the student to express everyday events.", "Review Simple Present (Only with I, You, They, We).", "Practice ongoing actions - Present Continuous.", "Teach the student to use the Possessive \"s\" (genitive case)."]'::jsonb, '["Asking for, expressing and understanding personal information.", "Talking about daily activities.", "Talking about ongoing actions.", "Talking about people and their belongings."]'::jsonb, null
from curriculum_tracks where level = 'A1';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 2, 'Appearance and Personality Features', '["Review the use of the present tense, presenting the student with the case of the irregular verb To Have (have/has).", "Practice making questions and negatives with the auxiliary verb To Do.", "Practice the use of the verb Can in common sentences (can I help you / abilities)."]'::jsonb, '["Talking about daily activities.", "Talking about ongoing activities.", "Talking about abilities, possibilities and permission.", "Talking simply about family and colleagues, describing their appearance and personalities."]'::jsonb, null
from curriculum_tracks where level = 'A1';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 3, 'School Life', '["Teach the Object Pronouns and the Possessive Pronouns.", "Teach how to use There Is/Are.", "Teach (without gap fill exercises) prepositions used to talk about time, Telling the time in a simple and direct way (without mentioning past to, a quarter to).", "Practice talking about Routine, the Duration and Frequency of Activities."]'::jsonb, '["Talking about people and their belongings.", "Describing the position of things and people.", "Talking about daily activities as well as their frequency and duration."]'::jsonb, null
from curriculum_tracks where level = 'A1';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 4, 'Natural Wonders and how to travel to these places?', '["Teach how to use Adjectives in English (It''s position before the verb).", "Review previous topics, focus on: simple present all forms; present continuous; there is/are; verb + s (third person).", "Teach the difference in the use of With and To."]'::jsonb, '["Talking about people and things, describing their characteristics and locations.", "Talking about ongoing actions.", "Talking about daily activities as well as their frequency and duration."]'::jsonb, null
from curriculum_tracks where level = 'A1';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 5, 'Places in Town', '["Practice talking about Likes and Dislikes. (Not mentioning love + gerund/ Like + gerund)", "Teach the use of the prepositions At, In and On.", "Review the uses of Can."]'::jsonb, '["Expressing likes and dislikes as well as talking about hobbies and interests.", "Describing the location of things and people.", "Talking about abilities, possibilities and permission.", "Describing locations and giving simple directions."]'::jsonb, null
from curriculum_tracks where level = 'A1';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 6, 'Around the world past and future events', '["Teach the Past Simple in the Affirmative, Negative and Interrogative forms. (Not mentioning irregular verbs yet.)", "Teach the use of “Going To” to express future events.", "Practice Talking about future arrangements.", "Practice Describing people, places and weather, introducing the most common irregular verbs.", "Practice Talking about past experiences.", "Teach about the Weather and Seasons."]'::jsonb, '["Talking about actions and events in the past.", "Talking about actions and events in the future.", "Talking about people and things, describing their characteristics and locations.", "Describing weather conditions."]'::jsonb, null
from curriculum_tracks where level = 'A1';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 7, 'It’s my body', '["Review Past Simple and Going To.", "Review making questions (do/does/did) and the Simple Present (third person).", "Teach irregular verbs in the simple past.", "Practice the most common irregular verbs."]'::jsonb, '["Talking about actions and events in the past.", "Talking about actions and events in the future.", "Asking and understanding questions about daily activities as well as hobbies and interests."]'::jsonb, null
from curriculum_tracks where level = 'A1';
-- ⚠️ A1+: No 'Vocabulary' section appears for any module in this PDF; 'vocabulary' left as an empty string for all modules.
-- ⚠️ A1+: Module list on the overview page (page 2) and the detail-page headings match in number and order (8 modules).

insert into curriculum_tracks (level, functions_of_language, grammar)
values ('A1+', '["Describing habits and routines, places, things and experiences.", "Giving and justifying opinions.", "Talking about routines and habits.", "Talking about intentions.", "Making comparisons.", "Talking about possibility.", "Giving directions and instructions.", "Making suggestions and offers.", "Apologizing.", "Describing the weather."]'::jsonb, '["Adjectives and modifiers. Countable and uncountable nouns. How much/How many. Few/little, much/many. Some, Any, Something, Anything, Nothing, Nobody.", "Comparatives and superlatives. Verb + ing: like/hate/love. Future with Will. Modals: can/can’t/could/couldn’t.", "Imperatives. Have to/need to for, obligation. Present Simple for future facts. Future Simple for future facts.", "I''d like to.", "Adverbs of Frequency."]'::jsonb);
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 1, 'Busy Time', '["Practice talking about Routine, the Duration and Frequency of Activities.", "Review using irregular verbs in the Simple Past.", "Teach the use of Frequency Adverbs. Introduce several ways of talking about Time.", "Review the Present Tense.", "Teach prepositions used to talk about place (Corner / Across / Front of)."]'::jsonb, '["Talking about daily activities as well as their frequency and duration.", "Talking about actions and events in the past.", "Telling time.", "Describing the position of things and people.", "Describing locations and giving simple directions."]'::jsonb, null
from curriculum_tracks where level = 'A1+';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 2, 'The pets that we love', '["Teach Adjectives and modifiers.", "Teach Comparatives.", "Review Which x What / Why x Because.", "Tech Countable and uncountable nouns.", "Teach Superlatives.", "Review Going To and Past Simple (irregular verbs)."]'::jsonb, '["Talking about people and things, describing their characteristics and locations.", "Making comparisons.", "Asking and understanding questions about preference and motivation.", "Talking about quantity.", "Talking about actions and events in the past.", "Talking about actions and events in the future."]'::jsonb, null
from curriculum_tracks where level = 'A1+';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 3, 'I''m so stressed', '["Review How much / How many.", "Teach the Imperative form.", "Teach Modal Verbs: Can, can''t / Could, couldn''t.", "Teach Some / Any / Something / Anything / Nothing / Nobody.", "Review comparatives and superlatives."]'::jsonb, '["Taking about the quantity of things.", "Asking about the quantity of things.", "Talking about abilities, possibilities and permission.", "Making suggestions and offers.", "Making comparisons.", "Describing things and people using superlatives."]'::jsonb, null
from curriculum_tracks where level = 'A1+';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 4, 'So you think you can play', '["Teach talking about the Future using Will.", "Teach the difference between Will and Going To.", "Review Frequency Adverbs.", "Review Some, Any, Something, Anything, Nothing, Nobody.", "Review Can, Can''t, Could, Couldn''t."]'::jsonb, '["Talking about future arrangements.", "Talking about immediate future.", "Talking about indefinite thing and indefinite quantity.", "Talking about abilities, possibilities and permission.", "Making suggestions and offers."]'::jsonb, null
from curriculum_tracks where level = 'A1+';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 5, 'Holiday! Celebrate!', '["Teach how to use Have To/Need To, when talking about obligation.", "Review How Much/How Many.", "Teach how to use the Present Simple when talking about future facts.", "Review There Is/There Are.", "Teach how to use the Future Simple when talking about future facts."]'::jsonb, '["Talking about needs and obligations.", "Talking about the quantity of things.", "Talking about future events.", "Describing locations and the positions of things and people."]'::jsonb, null
from curriculum_tracks where level = 'A1+';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 6, 'You are what you eat', '["Review the Past Simple (irregular verbs).", "Review the Comparatives.", "Review how many/how much.", "Review Going To.", "Review the difference between superlatives and comparatives."]'::jsonb, '["Talking about past actions and events.", "Making comparisons.", "Talking about the quantity of things.", "Talking about the future.", "Describing things and people using superlatives."]'::jsonb, null
from curriculum_tracks where level = 'A1+';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 7, 'DIY: Do it yourself!', '["Teach Would/Would Like.", "Review Will."]'::jsonb, '["Talking about wishes and aspirations.", "Talking about future events."]'::jsonb, null
from curriculum_tracks where level = 'A1+';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 8, 'Let’s take a selfie?', '["Review Countable and Uncountable nouns.", "Review Comparatives and Superlatives.", "Review How Many and How Much.", "Review Would.", "Review Will.", "Review Can/ Can''t/Could/Couldn''t."]'::jsonb, '["Talking about the quantity of things.", "Making questions about the quantity of things.", "Making comparisons.", "Describing things and people.", "Talking about the future.", "Making suggestions and offers.", "Talking about abilities, possibilities and permission."]'::jsonb, null
from curriculum_tracks where level = 'A1+';
-- ⚠️ A2: No 'Vocabulary' section appears for any module in this PDF; 'vocabulary' left as an empty string for all modules.
-- ⚠️ A2: Source PDF contains apparent typos transcribed literally: 'Tech although and however' (Module 2, should likely be 'Teach') and 'Review Verbo + Gerund' (Module 5, should likely be 'Verb').
-- ⚠️ A2: Module list on the overview page (page 3) ends each title with a period (e.g. 'There is no place like home.'); the detail-page headings (page 4-6) omit the trailing period. Used the detail-page title (no period) verbatim; titles otherwise match in wording, number, and order (6 modules).

insert into curriculum_tracks (level, functions_of_language, grammar)
values ('A2', '["Describing people.", "Describing past experiences.", "Talking about Obligation and necessity.", "Making Requests.", "Making Suggestions.", "Talking about personal experiences.", "Asking personal questions.", "Making travel arrangements.", "Ordering in a restaurant.", "Expressing preferences.", "Making deductions and predictions.", "Talking about obligation."]'::jsonb, '["Past simple. Past continuous. Adjectives: comparatives. Adjectives: superlatives.", "Future Time (will and going to). Modals – should, must and have to. Basic phrasal verbs. Prepositional phrases (place, time and movement).", "Verb + ing/infinitive. Zero and First Conditional. Used to + verb. Although/However.", "Present Simple Passive. When/While. Reflexive pronouns."]'::jsonb);
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 1, 'There is no place like home', '["Review the basic Prepositional Phrases and the Past Simple.", "Teach the Past Continuous.", "Review the comparative and superlative forms."]'::jsonb, '["Talking about past experiences in a more complex way.", "Describing people, things and experiences using comparatives and superlatives."]'::jsonb, null
from curriculum_tracks where level = 'A2';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 2, 'What''s it like to work at Google?', '["Teach using When and While.", "Teach the Modal Verbs should, must and have to.", "Review the future forms (will/going to).", "Tech although and however."]'::jsonb, '["Talking about Obligation and necessity.", "Making Suggestions.", "Describing past experiences.", "Talking about the future.", "Contrasting information.", "Talking about work life, interacting with coworkers and participating in meetings."]'::jsonb, null
from curriculum_tracks where level = 'A2';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 3, 'What are your favorite hobbies?', '["Review Would / Could.", "Teach Phrasal Verbs.", "Teach Present Simple Passive.", "Review Phrasal Verbs and Present Simple Passive."]'::jsonb, '["Talking about abilities and possibilities in the past.", "Speaking formally.", "Using phrasal verbs and everyday idiomatic expressions.", "Talking about hobbies, interests and leisure activities."]'::jsonb, null
from curriculum_tracks where level = 'A2';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 4, 'Traveling the world', '["Teach new Phrasal Verbs", "Review comparatives and superlatives.", "Teach Zero e First Conditionals.", "Review Phrasal Verbs, Zero and First Conditionals."]'::jsonb, '["Using phrasal verbs and everyday idiomatic expressions.", "Expressing conditions, cause and consequence at a basic level.", "Talking about travel plans."]'::jsonb, null
from curriculum_tracks where level = 'A2';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 5, 'Health and nutrition', '["Teach how to use Verb + Gerund.", "Teach how to use Reflexive Pronouns and review comparatives and superlatives.", "Review Verbo + Gerund and Reflexive Pronouns."]'::jsonb, '["Talking about health.", "Talking about medical conditions.", "Linking information together."]'::jsonb, null
from curriculum_tracks where level = 'A2';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 6, 'Sustainability', '["Teach how to use verb + Infinitive.", "Teach how to use Used to.", "Review verb + Infinitive and Used to."]'::jsonb, '["Talking about nature and the environment.", "Talking about past habits."]'::jsonb, null
from curriculum_tracks where level = 'A2';
-- ⚠️ A2+: No 'Vocabulary' section appears for any module in this PDF; 'vocabulary' left as an empty string for all modules.
-- ⚠️ A2+: Source PDF contains an apparent typo transcribed literally: 'Tech Be Able To/Good At' (Module 3, should likely be 'Teach').
-- ⚠️ A2+: Module list on the overview page (page 2) ends each title with a period (e.g. 'Orlando: The City Beautiful.'); the detail-page headings (pages 3-5) omit the trailing period. Used the detail-page title (no period) verbatim; titles otherwise match in wording, number, and order (7 modules).

insert into curriculum_tracks (level, functions_of_language, grammar)
values ('A2+', '["Checking understanding.", "Describing experience and events.", "Describing feelings and emotions."]'::jsonb, '["Present perfect. Be able to/good at.", "Adverbial phrases of time, place and frequency – including word order. Adverbs of frequency and manner.", "Question tags. So/such.", "Relative clauses."]'::jsonb);
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 1, 'Orlando: The City Beautiful', '["Review the Past Simple (irregular verbs), Past Continuous and Future Simple.", "Review Verb + Gerund.", "Teach \"As Well\", \"Deal\" (e.g.: \"it''s not a big deal\") and \"Sounds Good\".", "Teach Frequency Adverbs and Word Order."]'::jsonb, '["Describing past experiences in a complex way, being able to provide details.", "Using phrasal verbs and every day idiomatic expressions.", "Talking about daily activities as well as talking about their duration and frequency.", "Describing things, people and experiences in a complex way, being able to provide details."]'::jsonb, null
from curriculum_tracks where level = 'A2+';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 2, 'The Magic School Bus', '["Review Verb + Gerund.", "Teach the Present Perfect (affirmative form).", "Review Although and However."]'::jsonb, '["Talking about unfinished actions in the past.", "Contrasting information."]'::jsonb, null
from curriculum_tracks where level = 'A2+';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 3, 'Social Media', '["Review the Present Perfect (affirmative form).", "Teach the Present Perfect (interrogative form).", "Tech Be Able To/Good At.", "Review Verb + Gerund (love, hate, start, etc...).", "Review Be Able To/Good At."]'::jsonb, '["Talking about unfinished actions in the past.", "Talking about abilities and possibilities."]'::jsonb, null
from curriculum_tracks where level = 'A2+';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 4, 'Born to be wild', '["Teach the Present Perfect (negative form).", "Review the Present Perfect (affirmative and interrogative forms).", "Teach Relative Clauses (emphasis on Which x That, Whose, Whom).", "Review Relative Clauses and Review Verb + Gerund."]'::jsonb, '["Talking about unfinished actions in the past.", "Linking information and conveying longer and more complex ideas."]'::jsonb, null
from curriculum_tracks where level = 'A2+';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 5, 'Modern Day Slang', '["Teach common slang references in the United States.", "Teach I have been doing X I have done.", "Teach I am doing X I am going to do.", "Teach I used to X I am used to.", "Practice using Jargons and slangs."]'::jsonb, '["Using phrasal verbs and every day idiomatic expressions.", "Talking about unfinished actions in the past.", "Talking about future arrangements.", "Talking about past habits.", "Talking about current habits."]'::jsonb, null
from curriculum_tracks where level = 'A2+';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 6, 'The World of Gaming', '["Review question tags.", "Practice So and such."]'::jsonb, '["Confirming information.", "Explaining and illustrating information.", "Talking about and explaining rules of games."]'::jsonb, null
from curriculum_tracks where level = 'A2+';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 7, 'The Evolution of Science', '["Review adverbs ending in LY.", "Review the Five W Question Words and Sometimes H: Who? What? Where? When? How?", "Teach suffixes ending in \"ist\". Example: Biologist, Physicist.", "Teach prefixes. Example: Bio, Ab.", "Teach comparative X superlative adverbs.", "Teach irregular adverbs."]'::jsonb, '["Describing actions.", "Describing the past providing important details and milestones.", "Engaging in communication about familiar topics."]'::jsonb, null
from curriculum_tracks where level = 'A2+';
-- ⚠️ B1: Module pages do not include a 'Vocabulary' section for B1 (unlike Pre A1) — 'vocabulary' left as empty string for each module.

insert into curriculum_tracks (level, functions_of_language, grammar)
values ('B1', '["Expressing opinions: agreeing and disagreeing.", "Starting and ending a conversation.", "Managing interaction (interrupting, changing topic, resuming or continuing).", "Describing faulty goods.", "Talking about possibility/probability.", "Advising."]'::jsonb, '["Past continuous. Present perfect continuous. Past Simple and Present Perfect contrast. 2nd conditional.", "Modals: must/mustn''t. Modals: possibility – might, may, will. Phrasal verbs.", "Adverbs. Broader range of intensifiers such as \"too\" and \"enough\". Neither/Either/so. Reported speech.", "Be able to/can/manage to. Be allowed to and be supposed to. Although/in spite of/despite."]'::jsonb);
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 1, 'Tell me more about you!', '["Review the Past Continuous (Vocabulary expansion).", "Review Modal Verbs (can, may, would).", "Review verb + gerund.", "Teach the Present Perfect Continuous.", "Teach the Passive Voice.", "Review the difference between Present Perfect Continuous and Present Perfect."]'::jsonb, '["Describing past events in a complex way and being able to provide details.", "Talking about permission, possibilities, abilities and probability.", "Using formal register.", "Talking about unfinished actions in the past."]'::jsonb, null
from curriculum_tracks where level = 'B1';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 2, 'Scotland and Germany - Ancient civilizations', '["Review 1st conditional.", "Teach 2nd conditional.", "Teach Reported speech.", "Teach the Modal Verbs May / Might (talking about possibility).", "Review 1st e 2nd Conditionals and Past Continuous.", "Teach Be Allowed To / Be Supposed To.", "Review the Passive Voice."]'::jsonb, '["Talking about conditions, causes and consequences.", "Talking about possibilities and probabilities.", "Describing past events in a complex way and being able to provide details.", "Using formal register.", "Talking about obligations and expectations."]'::jsonb, null
from curriculum_tracks where level = 'B1';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 3, 'Great Britain in the twenty-first century', '["Teach Either / Neither / So.", "Teach in spite Of / Despite.", "Teach the uses of Too / Enough."]'::jsonb, '["Connecting and contrasting information.", "Emphasizing information."]'::jsonb, null
from curriculum_tracks where level = 'B1';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 4, 'How much does it matter? - Life Styles', '["Review Present Perfect, Present Continuous and Present Perfect Continuous.", "Teach Manage To (can, be able to).", "Practice Comparatives of Adjectives.", "Practice Neither/Either/Nor/Too.", "Review the Genitive Case.", "Practice 1st e 2nd Conditionals, Indefinite Pronouns and Reported Speech."]'::jsonb, '["Talking about unfinished actions in the past.", "Making comparisons.", "Connecting and contrasting information.", "Talking about conditions, causes and consequences.", "Reporting and retelling information."]'::jsonb, null
from curriculum_tracks where level = 'B1';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 5, 'Freedom in all its forms', '["Review Phrasal Verbs.", "Review Manage to, reported speech.", "Review Modal Verbs (must & have to).", "Review the difference between Simple past and Present perfect."]'::jsonb, '["Using phrasal verbs and everyday idiomatic expressions.", "Reporting and retelling information.", "Describing past events in a complex way and being able to provide details.", "Talking about obligations and necessity."]'::jsonb, null
from curriculum_tracks where level = 'B1';
-- ⚠️ B1+: Module pages do not include a 'Vocabulary' section for B1+ (unlike Pre A1) — 'vocabulary' left as empty string for each module.

insert into curriculum_tracks (level, functions_of_language, grammar)
values ('B1+', '["Criticizing and reviewing.", "Describing wishes and plans.", "Developing an argument.", "Expressing opinion.", "Encouraging and inviting another speaker to continue or to engage in the conversation."]'::jsonb, '["Past perfect. Future continuous. Will and going to, for prediction.", "Modals – should have/might have. 3rd conditional.", "Reported speech (range of tenses, direct speech). Simple passive voice.", "Complex question tags. Phrasal Verbs."]'::jsonb);
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 1, 'When books become movies.', '["Review Past simple and Present perfect.", "Review Present perfect continuous and Past continuous.", "Tach the Past perfect.", "Practice simple passive voice.", "Practice expressing opinion and criticizing."]'::jsonb, '["Contrasting finished and unfinished actions in the past.", "Describing past events in a complex way and being able to provide details.", "Using formal register."]'::jsonb, null
from curriculum_tracks where level = 'B1+';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 2, 'My life is a work of art!', '["Teach the future continuous.", "Review the past perfect.", "Review the passive voice."]'::jsonb, '["Talking about the future in a complex way.", "Talking about the past in a complex way.", "Using formal register."]'::jsonb, null
from curriculum_tracks where level = 'B1+';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 3, 'Are you a book hugger?', '["Tech the use of Will and going when making predictions.", "Teach Question tags.", "Review Question tags e will/going to."]'::jsonb, '["Talking about the future in a complex way.", "Confirming information."]'::jsonb, null
from curriculum_tracks where level = 'B1+';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 4, 'Lights, Camera, Action!', '["Teach Modal Verbs (should have, might have).", "Review Modal Verbs, will/going to and Question tags."]'::jsonb, '["Talking about obligations and necessities.", "Making suggestions and offers.", "Making deductions and speculations about the past.", "Talking about the future.", "Confirming information."]'::jsonb, null
from curriculum_tracks where level = 'B1+';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 5, 'Neuroscience: hypotheses of bilingualism.', '["Teach the 3rd conditional.", "Teach reported speech.", "Review reported speech and 3rd conditional."]'::jsonb, '["Expressing conditions, causes and consequences in a complex way.", "Reporting e retelling information."]'::jsonb, null
from curriculum_tracks where level = 'B1+';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 6, 'Eureka! An apple hit my head!', '["Teach Phrasal verbs.", "Review phrasal verbs and 3rd conditional.", "Practice reported speech."]'::jsonb, '["Expressing conditions, causes and consequences in a complex way.", "Reporting e retelling information.", "Using phrasal verbs and everyday idiomatic expressions."]'::jsonb, null
from curriculum_tracks where level = 'B1+';
-- ⚠️ B2: Module pages do not include a 'Vocabulary' section for B2 (unlike Pre A1) — 'vocabulary' left as empty string for each module.
-- ⚠️ B2: Module 3's Educational Goals and Functions of language lists span pages 4-5 (split by page break); Module 5's Functions of language list spans pages 5-6. Both were merged into single lists per the actual PDF text flow.

insert into curriculum_tracks (level, functions_of_language, grammar)
values ('B2', '["Expressing abstract ideas.", "Expressing agreement and disagreement.", "Expressing regret.", "Interacting informally, reacting, expressing interest, sympathy, surprise etc.", "Opinion, justification.", "Speculating.", "Taking the initiative in interaction.", "Synthesizing, evaluating, glossing info.", "Stating purpose.", "Stating contrast.", "Describing cause and effect.", "Clarifying."]'::jsonb, '["Adverbs. Past perfect continuous. Future continuous. Future Perfect.", "Modals of deduction and speculation. Phrasal verbs. Conjunctions: although, despite, in spite of, otherwise, unless.", "Relative clauses. Reported speech (range of tenses, indirect speech). Passive voice all tenses.", "Will and going to, for prediction. Wish and wish only: unreal conditions, wishes."]'::jsonb);
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 1, '42 University', '["Review Adverbs.", "Review the Passive Voice.", "Teach the Future Perfect.", "Review the Future Continuous.", "Teach the Past Perfect Continuous."]'::jsonb, '["Describing actions.", "Using formal register.", "Talking about the future in a complex way.", "Talking about the past in a complex way."]'::jsonb, null
from curriculum_tracks where level = 'B2';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 2, 'The Sharing Economy', '["Review the Passive Voice with focus on past and future tense.", "Review unusual Phrasal Verbs.", "Review Conjunctions (although, despite, in spite of) and new words such as: otherwise, unless.", "Teach Modals of Deduction and Speculation."]'::jsonb, '["Using formal register.", "Using complex phrasal verbs and idiomatic expressions.", "Connecting and contrasting information.", "Making deductions and speculations about the past."]'::jsonb, null
from curriculum_tracks where level = 'B2';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 3, 'And the Oscar goes to...', '["Teach describing Cause and Effect.", "Review Modals of deduction and speculation.", "Review the use of \"As If\", \"As Though\", \"Rather Than + Non-Finite Clause\".", "Practice Interacting informally, reacting, Expressing Interest, Sympathy, Surprise etc.", "Review Unusual Adverbs and Unusual Phrasal Verbs.", "Teach Relative Clauses."]'::jsonb, '["Describing cause and effect", "Making deductions and speculations about the past", "Connecting and contrasting information", "Using complex phrasal verbs and idiomatic expressions", "Interacting informally, reacting, expressing interest, sympathy, surprise etc."]'::jsonb, null
from curriculum_tracks where level = 'B2';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 4, 'Design Thinking', '["Teach Stating Contrast.", "Practice describing Cause and Effect.", "Practice Expressing Regret, Reported Speech and Indirect Speech.", "Teach Stating Purpose.", "Review Relative Clauses."]'::jsonb, '["Connecting and contrasting information.", "Talking about cause and effect in a complex way.", "Reporting and retelling information.", "Talking about purposes and goals."]'::jsonb, null
from curriculum_tracks where level = 'B2';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 5, 'Youtubing as a profession', '["Teach Mixed Conditionals.", "Review Conjunctions.", "Teach Synthesizing, Evaluating, Glossing Info.", "Review Modals of Deduction and Speculation.", "Practice Expressing Abstract Ideas."]'::jsonb, '["Expressing conditions in a complex way.", "Connecting and contrasting information.", "Synthesizing, Evaluating, Glossing Information.", "Making deductions and speculations about the past.", "Expressing Abstract Ideas."]'::jsonb, null
from curriculum_tracks where level = 'B2';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 6, 'The power of body language', '["Review Adverbs, Passive Voice and Conjunctions.", "Review Cause and Effect and Relative Clauses.", "Review Future Perfect, Past Perfect Continuous and Future Continuous.", "Practice Stating Contrast, Expressing Regret and Mixed Conditionals."]'::jsonb, '["Using formal register.", "Connecting and contrasting information.", "Talking about the future in a complex way.", "Talking about conditions in a complex way."]'::jsonb, null
from curriculum_tracks where level = 'B2';
-- ⚠️ B2+: No 'Vocabulary' section/field present per module in this PDF (unlike Pre A1); left as empty string for each module.

insert into curriculum_tracks (level, functions_of_language, grammar)
values ('B2+', '["Developing an argument systematically.", "Responding to counterarguments.", "Defending a point of view persuasively.", "Expressing attitudes and feelings precisely.", "Emphasizing a point feeling or issue.", "Summarizing."]'::jsonb, '["Future perfect (review).", "Future perfect continuous.", "Mixed conditionals. (Tenses, ranges and forms).", "Past forms (Review).", "\"Would\" expressing past habits.", "Complex passive. (Passive voice in all tenses, ranges and forms and other complex structures).", "Narrative tenses.", "Verb + gerund (Review).", "Relative clauses (Review).", "Conjunctions (Review).", "Linking words (Emphasis, reiteration, intermediation).", "Idioms and phrasal verbs."]'::jsonb);
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 1, 'Blast off!', '["Review future forms.", "Teach the future perfect.", "Teach phrasal verbs and idioms related to the theme.", "Practice verb + gerund.", "Practice conjunctions.", "Practice Linking words."]'::jsonb, '["Talking about the future in a complex way.", "Using complex phrasal verbs and idiomatic expressions.", "Connecting and contrasting information."]'::jsonb, null
from curriculum_tracks where level = 'B2+';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 2, 'The Future of Humanity', '["Review future forms.", "Review the future perfect.", "Teach the future perfect continuous.", "Review conditionals tenses and forms.", "Teach phrasal verbs and idioms related to the theme."]'::jsonb, '["Using complex phrasal verbs and idiomatic expressions.", "Expressing conditions, causes and consequences in a complex way."]'::jsonb, null
from curriculum_tracks where level = 'B2+';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 3, 'Cyber Crime', '["Review verb patterns.", "Practice passive structures.", "Practice conditionals and modal verbs.", "Practice adjective modifiers.", "Teach phrasal verbs and idioms related to the theme."]'::jsonb, '["Describing actions, situations and events in the future, present and past.", "Using formal register.", "Expressing conditions, causes and consequences in a complex way.", "Talking about obligations, necessities, possibilities and probabilities.", "Expressing emphasis, intensity and subtlety.", "Using complex phrasal verbs and idiomatic expressions."]'::jsonb, null
from curriculum_tracks where level = 'B2+';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 4, 'Money Matters', '["Review Past forms.", "Review used to.", "Teach would to express past habits.", "Teach the contrast between used to and would.", "Review paired conjunctions (not only ... but also, neither...nor).", "Teach linking words (because of this, this way, therefore, such as, due to, that''s why).", "Teach phrasal verbs and idioms related to the theme."]'::jsonb, '["Talking about the past in a complex way being able to provide details.", "Talking about past habits.", "Connecting and contrasting information.", "Using complex phrasal verbs and idiomatic expressions.", "Talking about finances."]'::jsonb, null
from curriculum_tracks where level = 'B2+';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 5, 'Helping the Planet', '["Review the passive voice (Tenses and forms).", "Teach passive voice - complex structures.", "Review conjunctions and paired conjunctions.", "Practice Verb + gerund.", "Practice relative clauses.", "Practice Linking words (such as, thus, besides, therefore, lastly, due to, in order to).", "Teach phrasal verbs and idioms related to the theme."]'::jsonb, '["Using formal register.", "Connecting and contrasting information.", "Using complex phrasal verbs and idiomatic expressions.", "Talking about the environment, environmental issues and sustainability."]'::jsonb, null
from curriculum_tracks where level = 'B2+';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 6, 'Natural Disasters', '["Teach narrative tenses.", "Practice past tenses.", "Practice passive voice.", "Review reported speech.", "Teach narrative writing.", "Teach argumentative writing.", "Teach phrasal verbs and idioms related to the them."]'::jsonb, '["Narrating stories and events transitioning through various verb tenses.", "Reporting and retelling information.", "Using complex phrasal verbs and idiomatic expressions."]'::jsonb, null
from curriculum_tracks where level = 'B2+';
-- ⚠️ C1: No 'Vocabulary' section/field present per module in this PDF (unlike Pre A1); left as empty string for each module.
-- ⚠️ C1: Page 2 also contains a 'C1 – Common European Framework' descriptive paragraph before Functions of Language/Grammar; not captured as a separate field since it is not part of the requested schema.
-- ⚠️ C1: Module 7 and Module 8 heading in source PDF reads 'Functions of language' (lowercase 'l'), unlike other modules' 'Functions of Language:' — transcribed as-is, field name unaffected.
-- ⚠️ C1: Source text contains apparent typo 'implied meeting' (Modules 7 and 8) — transcribed literally per instructions, not corrected to 'implied meaning'.

insert into curriculum_tracks (level, functions_of_language, grammar)
values ('C1', '["Understand and express long and complex information.", "Understand and express technical and specific terms related to certain areas and or subjects.", "Understand implied meaning.", "Define and describe concepts.", "Summarize and paraphrase.", "Express order, purpose and different degrees of intensity."]'::jsonb, '["Present tense verb forms", "Past tense verb forms", "Future tense verb forms", "Complex passive voice", "Complex conditional clauses", "To and for used to express purpose", "Adverbs of degree and intensity", "Word formation", "Discourse markers", "Inversions", "Expressions using Do and Make", "Adjectives ending in ED and ING", "Phrasal verbs, Idioms, and specific vocabulary", "Special gerund cases", "Causative structure"]'::jsonb);
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 1, 'Business Fundamentals', '["Review present tense verb forms;", "Review complex passive voice;", "Teach phrasal verbs and idiomatic expressions related to the business world."]'::jsonb, '["Talking about the present in a complex way, being able to provide details;", "Using formal register;", "Using and understanding complex phrasal verbs and idiomatic expressions;", "Talking about business."]'::jsonb, null
from curriculum_tracks where level = 'C1';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 2, 'Medicine and Health', '["Review past tense verb forms;", "Reinforce the use of the prepositions to and for when expressing purpose;", "Teach adverbs of degree and intensity;", "Teach phrasal verbs and idiomatic expressions related to medicine and health."]'::jsonb, '["Talking about the past in a complex way and being able to provide details;", "Expressing purpose;", "Giving emphasis or subtlety to things as well as expressing different degrees of intensity;", "Using and understanding complex phrasal verbs and idiomatic expressions;", "Talking about medicine, health and well-being."]'::jsonb, null
from curriculum_tracks where level = 'C1';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 3, 'English: A Strange Language', '["Review complex passive voice;", "Review conditional clauses;", "Teach wish/if only when expressing desires and aspirations;", "Teach British phrasal verbs and idiomatic expressions."]'::jsonb, '["Using formal register;", "Expressing conditions, causes and consequences in a complex way;", "Talking about desires and aspirations in a complex way;", "Using and understanding complex phrasal verbs and idiomatic expressions."]'::jsonb, null
from curriculum_tracks where level = 'C1';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 4, 'We Are the World', '["Reinforce the use of prefixes such as; anti, out, over, mis, post, co, inter, intra in word formation;", "Teach discourse markers;", "Reinforce the use of compound adjectives;", "Teach special conditional clauses such as; only if, even if, supposing, provided that, as long as, in case, unless, otherwise, or else;", "Teach phrasal verbs and idiomatic expressions related to culture and diversity."]'::jsonb, '["Expressing conditions, causes and consequences in a complex way;", "Organizing ideas and expressing order;", "Using and understanding complex phrasal verbs and idiomatic expressions;", "Talking about culture and diversity."]'::jsonb, null
from curriculum_tracks where level = 'C1';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 5, 'Business: Going Abroad', '["Review future tense verb forms;", "Review complex passive voice;", "Teach inversions;", "Teach phrasal verbs and idiomatic expressions related to the business world and business trips."]'::jsonb, '["Talking about the future in a complex way being able to provide details;", "Using formal register;", "Using and understanding complex phrasal verbs and idiomatic expressions;", "Talking about business."]'::jsonb, null
from curriculum_tracks where level = 'C1';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 6, 'Knowledge is Power', '["Review the use of the prepositions to and for when expressing purpose, adverbs of degree and intensity, compound adjectives, special conditional clauses and prefixes;", "Reinforce discourse markers;", "Reinforce the use of adjectives ending in ED and ING;", "Teach expressions with do and make;", "Teach phrasal verbs and idiomatic expressions related to education."]'::jsonb, '["Expressing purpose;", "Giving emphasis or subtlety to things as well as expressing different degrees of intensity;", "Expressing conditions, causes and consequences in a complex way;", "Organizing ideas and expressing order;", "Using and understanding complex phrasal verbs and idiomatic expressions;", "Talking about education."]'::jsonb, null
from curriculum_tracks where level = 'C1';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 7, 'The Justice System', '["Reinforce discourse markers, adverbs of degree and intensity, conditionals using wish/if only, and inversions;", "Teach the use of as if/as though;", "Teach phrasal verbs and idiomatic expressions related to crime and the justice system."]'::jsonb, '["Defining and describing concepts and events, expressing order, purpose, and intensity to things and events.", "Expressing emphasis or subtlety", "Understanding longer and complex information, implied meeting, summarizing, and paraphrasing."]'::jsonb, null
from curriculum_tracks where level = 'C1';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 8, 'Let''s Get Political', '["Reinforce discourse markers, adverbs of degree and intensity, conditionals using wish/if only, and inversions;", "Reinforce word formation;", "Teach special gerund cases;", "Teach causative structures;", "Teach phrasal verbs and idiomatic expressions related to politics."]'::jsonb, '["Defining and describing concepts and events, expressing order, purpose, and intensity to things and events.", "Expressing emphasis or subtlety", "Understanding longer and complex information, implied meeting, summarizing, and paraphrasing."]'::jsonb, null
from curriculum_tracks where level = 'C1';
-- ⚠️ C2: The 'Modules' overview list on the visão geral page (page 3) lists only 5 modules (1: Art Is All Around Us!, 2: Media & Communication, 3: A Multicultural World: Know the Accents, 4: Changing the Game, 5: Pop Culture), but the detail pages (pages 4-7) contain 8 modules — Module 6 'Love Is in the Air', Module 7 'Understanding Adulthood', and Module 8 '21st Century Businesses' are present in full detail but absent from the overview list. Transcribed all 8 detailed modules; overview divergence flagged as required.
-- ⚠️ C2: No 'Vocabulary' section/field present per module in this PDF (unlike Pre A1); left as empty string for each module.

insert into curriculum_tracks (level, functions_of_language, grammar)
values ('C2', '["Define and describe feelings, emotions, and situations", "Understand complex and specific information", "Talk about hypothetical and probable situations", "Use formal register and technical vocabulary", "Study different words with the same root", "Understand text structure and its elements"]'::jsonb, '["Adjectives ING x ED", "Adjectives and Modifiers", "Affixes (Prefixes and Suffixes)", "Compound Words (Adjectives, Nouns)", "Adverbs of Degree and Intensity", "Collocations", "Dependent Prepositions & Prepositional Phrases", "Inversions", "Narrative tenses", "Wish/If only", "As if/As though", "Causative Structures", "Participle Clauses", "Special Gerund Formations", "Linking Words/Discourse Markers", "Probability (bound to, likely to, prone to, liable to)", "Irregular plural forms", "Perfect Tenses and Forms", "Phrasal verbs, Vocabulary and Expressions"]'::jsonb);
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 1, 'Art Is All Around Us!', '["Reinforce adjectives and adjective order;", "Reinforce adverbs of degree and intensity;", "Teach different types of word formation (affixes, compound words);", "Teach descriptive writing;", "Teach phrasal verbs and idioms related to the arts."]'::jsonb, '["Defining and describing feelings, emotions, and situations;", "Describing events in detail;", "Using and understanding complex vocabulary and idiomatic expressions;", "Understanding longer, complex, and detailed information."]'::jsonb, null
from curriculum_tracks where level = 'C2';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 2, 'Media & Communication', '["Reinforce word formation;", "Review inversions;", "Review wish/if only;", "Review as if/as though;", "Teach phrasal verbs and idioms related to the theme."]'::jsonb, '["Expressing probability and desires;", "Organizing ideas and expressing order;", "Using and understanding complex vocabulary and idiomatic expressions;", "Understanding longer and more complex information;", "Introducing the world of media and its vocabulary."]'::jsonb, null
from curriculum_tracks where level = 'C2';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 3, 'A Multicultural World: Know the Accents', '["Introduce different types of collocations;", "Review compound words and word formation;", "Reinforce adjective order and adverbs;", "Reinforce prepositions and prepositional phrases;", "Reinforce discourse markers and speech fillers;", "Teach different language variations and their pronunciation."]'::jsonb, '["Describing situations, feelings, and events;", "Organizing ideas and expressing order;", "Using and understanding complex vocabulary and idiomatic expressions;", "Showing different English accents and language variations."]'::jsonb, null
from curriculum_tracks where level = 'C2';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 4, 'Changing the Game', '["Introduce dependent prepositions;", "Review prepositional phrases;", "Review collocations;", "Introduce perfect infinitive;", "Review modals in the past;", "Review adjective order;", "Teach vocabulary and expressions related to the world of sports and fitness."]'::jsonb, '["Describing situations, feelings, and events;", "Organizing ideas and expressing order;", "Understanding sports-related vocabulary;", "Telling stories and explaining general and specific information."]'::jsonb, null
from curriculum_tracks where level = 'C2';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 5, 'Pop Culture', '["Teach participle clauses;", "Review narrative tenses;", "Reinforce causative structures;", "Review inversions;", "Review collocations;", "Teach phrasal verbs and vocabulary related to the theme."]'::jsonb, '["Understanding cause and effect;", "Using and understanding storytelling resources;", "Using and understanding specific phrasal verbs and idiomatic expressions;", "Expressing information in a more economical way."]'::jsonb, null
from curriculum_tracks where level = 'C2';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 6, 'Love Is in the Air', '["Teach how to talk about probability (likely to, bound to, prone to, liable to);", "Reinforce collocations;", "Reinforce special gerund formations;", "Review discourse markers;", "Review as if/as though;", "Review wish/if only;", "Review inversions;", "Teach new vocabulary, expressions, and phrasal verbs related to the theme."]'::jsonb, '["Defining and describing feelings, emotions, and events;", "Talking about hypothetical situations;", "Introducing more complex and technical information;", "Describing future events and different probabilities;", "Using formal register."]'::jsonb, null
from curriculum_tracks where level = 'C2';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 7, 'Understanding Adulthood', '["Reinforce dependent prepositions;", "Review irregular plural forms;", "Review participle clauses;", "Use formal register, as well as technical vocabulary;", "Teach vocabulary, phrasal verbs, and expressions related to the theme."]'::jsonb, '["Talking about processes in a complex way, being able to provide details;", "Introducing more complex and technical information;", "Using and understanding bureaucratic vocabulary;", "Understanding different processes in adult life."]'::jsonb, null
from curriculum_tracks where level = 'C2';
insert into curriculum_topics (track_id, position, title, educational_goals, functions_of_language, vocabulary)
select id, 8, '21st Century Businesses', '["Reinforce collocations;", "Reinforce prepositions (dependent & prepositional phrases);", "Review inversions;", "Review wish/if only;", "Review as if/as though;", "Review causative structures;", "Review participle clauses;", "Review special gerund formations;", "Review how to talk about probability (likely to, bound to, prone to, liable to);", "Introduce technology and business vocabulary, phrasal verbs, and expressions."]'::jsonb, '["Talking about the present in a complex way, being able to provide details;", "Using formal register;", "Introducing and understanding complex phrasal verbs and idiomatic expressions;", "Introduce technological and business terminology;", "Reviewing previous knowledge related to grammar and vocabulary."]'::jsonb, null
from curriculum_tracks where level = 'C2';
