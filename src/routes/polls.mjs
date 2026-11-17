
import { Poll, PollAnswer } from '../models/poll.mjs';
import { authRouter } from '../middlewares/auth.mjs';
import {
  asyncHandler, HttpError, pick, validIds, listPage, withSearch
} from '../utils/http.mjs';
import {
  loadEvent, assertCanViewEvent, assertOrganizer, assertParticipant, isParticipant
} from '../services/access.mjs';

const router = authRouter();

const loadPoll = async (id) => {
  const poll = await Poll.findById(id);
  if (!poll) throw new HttpError(404, 'Sondage introuvable');
  return poll;
};

const buildQuestions = (questions) => (Array.isArray(questions)
  ? questions.map((q) => ({
    label: q?.label,
    options: Array.isArray(q?.options) ? q.options.map((o) => ({ label: o?.label })) : []
  }))
  : []);

// Un sondage est créé par un organisateur
router.post('/events/:eventId/polls', validIds('eventId'), asyncHandler(async (req, res) => {
  const event = await loadEvent(req.params.eventId);
  assertCanViewEvent(event, req.user);
  assertOrganizer(event, req.user);

  const { title, questions } = pick(req.body, ['title', 'questions']);
  const poll = await Poll.create({
    title,
    // On reconstruit les questions pour ne retenir que les champs autorisés
    questions: buildQuestions(questions),
    event: event._id,
    createdBy: req.user._id
  });
  res.status(201).json(poll);
}));

router.get('/events/:eventId/polls', validIds('eventId'), asyncHandler(async (req, res) => {
  const event = await loadEvent(req.params.eventId);
  assertCanViewEvent(event, req.user);
  res.json(await listPage(Poll, withSearch({ event: event._id }, req.query.q, ['title', 'questions.label']), req.query, { createdAt: 1 }));
}));

router.get('/polls/:pollId', validIds('pollId'), asyncHandler(async (req, res) => {
  const poll = await loadPoll(req.params.pollId);
  assertCanViewEvent(await loadEvent(poll.event), req.user);
  res.json(poll);
}));

// Modification par un organisateur. Les questions ne sont modifiables que tant
// que personne n'a répondu (sinon les réponses déjà données perdraient leur sens).
router.patch('/polls/:pollId', validIds('pollId'), asyncHandler(async (req, res) => {
  const poll = await loadPoll(req.params.pollId);
  const event = await loadEvent(poll.event);
  assertCanViewEvent(event, req.user);
  assertOrganizer(event, req.user);

  const { title, questions } = pick(req.body, ['title', 'questions']);
  if (questions !== undefined) {
    if (await PollAnswer.exists({ poll: poll._id })) {
      throw new HttpError(409, 'Les questions ne peuvent plus être modifiées : des réponses existent déjà');
    }
    poll.questions = buildQuestions(questions);
  }
  if (title !== undefined) poll.title = title;
  await poll.save();
  res.json(poll);
}));

router.delete('/polls/:pollId', validIds('pollId'), asyncHandler(async (req, res) => {
  const poll = await loadPoll(req.params.pollId);
  const event = await loadEvent(poll.event);
  assertCanViewEvent(event, req.user);
  assertOrganizer(event, req.user);
  await PollAnswer.deleteMany({ poll: poll._id });
  await poll.deleteOne();
  res.status(204).end();
}));

// Un participant répond à chaque question en choisissant UNE seule réponse
router.post('/polls/:pollId/answers', validIds('pollId'), asyncHandler(async (req, res) => {
  const poll = await loadPoll(req.params.pollId);
  const event = await loadEvent(poll.event);
  assertCanViewEvent(event, req.user);
  assertParticipant(event, req.user);

  const submitted = req.body?.answers;
  if (!Array.isArray(submitted)) throw new HttpError(400, 'answers doit être un tableau');

  const chosen = new Map();
  submitted.forEach((a) => {
    const questionId = String(a?.questionId);
    if (chosen.has(questionId)) throw new HttpError(400, 'Une seule réponse possible par question');
    chosen.set(questionId, String(a?.optionId));
  });

  const answers = poll.questions.map((question) => {
    const optionId = chosen.get(String(question._id));
    if (!optionId) throw new HttpError(400, `Il manque une réponse à la question « ${question.label} »`);
    if (!question.options.some((o) => String(o._id) === optionId)) {
      throw new HttpError(400, `Réponse invalide pour la question « ${question.label} »`);
    }
    return { question: question._id, option: optionId };
  });
  if (chosen.size !== poll.questions.length) {
    throw new HttpError(400, 'Certaines questions sont inconnues pour ce sondage');
  }

  const saved = await PollAnswer.create({ poll: poll._id, user: req.user._id, answers });
  res.status(201).json(saved);
}));

router.get('/polls/:pollId/results', validIds('pollId'), asyncHandler(async (req, res) => {
  const poll = await loadPoll(req.params.pollId);
  const event = await loadEvent(poll.event);
  assertCanViewEvent(event, req.user);
  if (!isParticipant(event, req.user)) throw new HttpError(403, "Réservé aux participants de l'événement");

  const answers = await PollAnswer.find({ poll: poll._id });
  const results = poll.questions.map((question) => ({
    questionId: question.id,
    label: question.label,
    options: question.options.map((option) => ({
      optionId: option.id,
      label: option.label,
      votes: answers.filter((a) => a.answers.some(
        (x) => String(x.question) === String(question._id) && String(x.option) === String(option._id)
      )).length
    }))
  }));
  res.json({ pollId: poll.id, title: poll.title, totalResponses: answers.length, results });
}));

export default router;
