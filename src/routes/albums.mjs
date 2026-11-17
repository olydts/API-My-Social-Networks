
import { Album, Photo, PhotoComment } from '../models/photo.mjs';
import { authRouter } from '../middlewares/auth.mjs';
import {
  asyncHandler, HttpError, pick, validIds, listPage, withSearch
} from '../utils/http.mjs';
import {
  loadEvent, assertCanViewEvent, assertParticipant, isOrganizer
} from '../services/access.mjs';

const router = authRouter();

const loadAlbum = async (id) => {
  const album = await Album.findById(id);
  if (!album) throw new HttpError(404, 'Album introuvable');
  return album;
};

// ---- Albums (1 album = 1 événement) ----
router.post('/events/:eventId/albums', validIds('eventId'), asyncHandler(async (req, res) => {
  const event = await loadEvent(req.params.eventId);
  assertCanViewEvent(event, req.user);
  assertParticipant(event, req.user);
  const album = await Album.create({
    ...pick(req.body, ['title']), event: event._id, createdBy: req.user._id
  });
  res.status(201).json(album);
}));

router.get('/events/:eventId/albums', validIds('eventId'), asyncHandler(async (req, res) => {
  const event = await loadEvent(req.params.eventId);
  assertCanViewEvent(event, req.user);
  res.json(await listPage(Album, withSearch({ event: event._id }, req.query.q, ['title']), req.query, { createdAt: 1 }));
}));

router.get('/albums/:albumId', validIds('albumId'), asyncHandler(async (req, res) => {
  const album = await loadAlbum(req.params.albumId);
  assertCanViewEvent(await loadEvent(album.event), req.user);
  res.json(album);
}));

router.patch('/albums/:albumId', validIds('albumId'), asyncHandler(async (req, res) => {
  const album = await loadAlbum(req.params.albumId);
  const event = await loadEvent(album.event);
  assertCanViewEvent(event, req.user);
  if (String(album.createdBy) !== String(req.user._id) && !isOrganizer(event, req.user)) {
    throw new HttpError(403, "Seul le créateur ou un organisateur peut modifier cet album");
  }
  album.set(pick(req.body, ['title']));
  await album.save();
  res.json(album);
}));

router.delete('/albums/:albumId', validIds('albumId'), asyncHandler(async (req, res) => {
  const album = await loadAlbum(req.params.albumId);
  const event = await loadEvent(album.event);
  assertCanViewEvent(event, req.user);
  if (String(album.createdBy) !== String(req.user._id) && !isOrganizer(event, req.user)) {
    throw new HttpError(403, "Seul le créateur ou un organisateur peut supprimer cet album");
  }
  const photos = await Photo.find({ album: album._id }).distinct('_id');
  await PhotoComment.deleteMany({ photo: { $in: photos } });
  await Photo.deleteMany({ album: album._id });
  await album.deleteOne();
  res.status(204).end();
}));

// ---- Photos (postées par un participant) ----
router.post('/albums/:albumId/photos', validIds('albumId'), asyncHandler(async (req, res) => {
  const album = await loadAlbum(req.params.albumId);
  const event = await loadEvent(album.event);
  assertCanViewEvent(event, req.user);
  assertParticipant(event, req.user);
  const photo = await Photo.create({
    ...pick(req.body, ['url', 'caption']),
    album: album._id,
    event: event._id,
    postedBy: req.user._id
  });
  res.status(201).json(photo);
}));

router.get('/albums/:albumId/photos', validIds('albumId'), asyncHandler(async (req, res) => {
  const album = await loadAlbum(req.params.albumId);
  assertCanViewEvent(await loadEvent(album.event), req.user);
  res.json(await listPage(Photo, withSearch({ album: album._id }, req.query.q, ['caption']), req.query, { createdAt: 1 }));
}));

router.get('/photos/:photoId', validIds('photoId'), asyncHandler(async (req, res) => {
  const photo = await Photo.findById(req.params.photoId);
  if (!photo) throw new HttpError(404, 'Photo introuvable');
  assertCanViewEvent(await loadEvent(photo.event), req.user);
  res.json(photo);
}));

router.patch('/photos/:photoId', validIds('photoId'), asyncHandler(async (req, res) => {
  const photo = await Photo.findById(req.params.photoId);
  if (!photo) throw new HttpError(404, 'Photo introuvable');
  assertCanViewEvent(await loadEvent(photo.event), req.user);
  if (String(photo.postedBy) !== String(req.user._id)) {
    throw new HttpError(403, "Seul l'auteur peut modifier cette photo");
  }
  photo.set(pick(req.body, ['url', 'caption']));
  await photo.save();
  res.json(photo);
}));

router.delete('/photos/:photoId', validIds('photoId'), asyncHandler(async (req, res) => {
  const photo = await Photo.findById(req.params.photoId);
  if (!photo) throw new HttpError(404, 'Photo introuvable');
  const event = await loadEvent(photo.event);
  assertCanViewEvent(event, req.user);
  if (String(photo.postedBy) !== String(req.user._id) && !isOrganizer(event, req.user)) {
    throw new HttpError(403, "Seul l'auteur ou un organisateur peut supprimer cette photo");
  }
  await PhotoComment.deleteMany({ photo: photo._id });
  await photo.deleteOne();
  res.status(204).end();
}));

// ---- Commentaires (par des participants de l'événement) ----
router.post('/photos/:photoId/comments', validIds('photoId'), asyncHandler(async (req, res) => {
  const photo = await Photo.findById(req.params.photoId);
  if (!photo) throw new HttpError(404, 'Photo introuvable');
  const event = await loadEvent(photo.event);
  assertCanViewEvent(event, req.user);
  assertParticipant(event, req.user);
  const comment = await PhotoComment.create({
    ...pick(req.body, ['content']), photo: photo._id, author: req.user._id
  });
  res.status(201).json(comment);
}));

router.get('/photos/:photoId/comments', validIds('photoId'), asyncHandler(async (req, res) => {
  const photo = await Photo.findById(req.params.photoId);
  if (!photo) throw new HttpError(404, 'Photo introuvable');
  assertCanViewEvent(await loadEvent(photo.event), req.user);
  res.json(await listPage(PhotoComment, withSearch({ photo: photo._id }, req.query.q, ['content']), req.query, { createdAt: 1 }));
}));

router.patch('/comments/:commentId', validIds('commentId'), asyncHandler(async (req, res) => {
  const comment = await PhotoComment.findById(req.params.commentId);
  if (!comment) throw new HttpError(404, 'Commentaire introuvable');
  const photo = await Photo.findById(comment.photo);
  assertCanViewEvent(await loadEvent(photo.event), req.user);
  if (String(comment.author) !== String(req.user._id)) {
    throw new HttpError(403, "Seul l'auteur peut modifier son commentaire");
  }
  comment.set(pick(req.body, ['content']));
  await comment.save();
  res.json(comment);
}));

router.delete('/comments/:commentId', validIds('commentId'), asyncHandler(async (req, res) => {
  const comment = await PhotoComment.findById(req.params.commentId);
  if (!comment) throw new HttpError(404, 'Commentaire introuvable');
  const photo = await Photo.findById(comment.photo);
  const event = await loadEvent(photo.event);
  assertCanViewEvent(event, req.user);
  if (String(comment.author) !== String(req.user._id) && !isOrganizer(event, req.user)) {
    throw new HttpError(403, "Seul l'auteur ou un organisateur peut supprimer ce commentaire");
  }
  await comment.deleteOne();
  res.status(204).end();
}));

export default router;
