'use strict';

// Question packs. "who" questions are answered by voting for a group member,
// "wyr" (this-or-that) questions by picking option a or b.
// Question ids come from each pack's position in its list, so keep the order when editing.

const who = (texts) => texts.map((text) => ({ type: 'who', text }));
const wyr = (rows) => rows.map(([text, a, b]) => ({ type: 'wyr', text, a, b }));

// French typography: non-breaking space before ? ! : ;
const fr = (s) => s && s.replace(/ ([?!:;])/g, ' $1');

const RAW_PACKS = [
  {
    id: 'classic',
    name: 'Le classique',
    icon: 'crown',
    color: '#e06c6c',
    prefix: 'Qui a le plus de chances de…',
    description: 'L’incontournable. Découvre ce que tes potes pensent vraiment de toi.',
    questions: who([
      'devenir célèbre ?', 'oublier son propre anniversaire ?', 'survivre à une apocalypse zombie ?', 'pleurer devant un film ?',
      'monter sa propre boîte ?', 'se perdre dans sa propre ville ?', 'adopter dix animaux ?', 'gagner une émission de téléréalité ?',
      'devenir millionnaire ?', 'rire au pire moment possible ?', 'partir vivre à l’étranger ?',
      'manger un truc tombé par terre ?', 'envoyer un message à la mauvaise personne ?', 'dépenser tout son argent en une journée ?',
      'devenir prof ?', 's’endormir en soirée ?', 'être encore debout à 4 h du matin ?', 'faire le buzz sur internet ?',
      'oublier où sa voiture est garée ?', 'écrire un livre ?', 'courir un marathon ?', 'arriver en retard à son propre mariage ?',
      'parler à des inconnus dans le train ?', 'se faire tatouer sur un coup de tête ?', 'regarder une série entière en une nuit ?',
      'finir à l’Élysée ?', 'gagner au loto et perdre le ticket ?', 'annuler au dernier moment ?',
      'organiser le voyage parfait ?', 'rater des pâtes ?', 'chanter le plus fort sous la douche ?',
      'être toujours à l’heure ?', 'devenir pote avec une star ?', 'garder un secret toute sa vie ?',
      'trop en raconter sur les réseaux ?', 'répondre en premier sur le groupe ?', 'partir d’une soirée sans dire au revoir ?',
      'échanger un cadeau ?', 'vivre dans une ferme un jour ?', 'inventer un truc génial ?',
    ]),
  },
  {
    id: 'rather',
    name: 'Qui préférerait',
    icon: 'question',
    color: '#a78bd6',
    prefix: 'Qui préférerait…',
    description: 'Des dilemmes qui en disent long.',
    questions: who([
      'vivre sans musique plutôt que sans café ?', 'explorer l’espace plutôt que les fonds marins ?',
      'avoir un chat plutôt qu’un chien ?', 'rester chez soi plutôt que sortir un vendredi soir ?', 'voyager en solo plutôt qu’en groupe ?',
      'lire le livre plutôt que voir le film ?', 'être une star de la chanson plutôt que du cinéma ?',
      'vivre à la montagne plutôt qu’au bord de la mer ?', 'manger de la pizza tous les jours plutôt que plus jamais ?',
      'se lever à 5 h plutôt que se coucher à 3 h ?', 'avoir un bouton retour arrière plutôt qu’un bouton pause ?',
      'être invisible plutôt que savoir voler ?', 'gagner une médaille olympique plutôt qu’un Oscar ?',
      'camper plutôt que dormir dans un 5 étoiles ?', 'se passer de son téléphone plutôt que de son lit pendant une semaine ?',
      'vivre dans le passé plutôt que dans le futur ?', 'être la personne la plus drôle plutôt que la plus intelligente ?',
      'avoir un chef perso plutôt qu’un chauffeur perso ?', 'parler aux animaux plutôt que parler toutes les langues ?',
      'tout planifier plutôt que tout improviser ?',
    ]),
  },
  {
    id: 'debates',
    name: 'Ceci ou cela',
    icon: 'chat',
    color: '#5fb8c4',
    prefix: 'Tu es de quel côté ?',
    description: 'Des débats express qui coupent le groupe en deux.',
    questions: wyr([
      ['Matin ou soir ?', 'Matin', 'Soir'],
      ['Plage ou montagne ?', 'Plage', 'Montagne'],
      ['Chats ou chiens ?', 'Chats', 'Chiens'],
      ['Sucré ou salé ?', 'Sucré', 'Salé'],
      ['Messages ou appels ?', 'Messages', 'Appels'],
      ['Été ou hiver ?', 'Été', 'Hiver'],
      ['Café ou thé ?', 'Café', 'Thé'],
      ['Livres ou films ?', 'Livres', 'Films'],
      ['Ville ou campagne ?', 'Ville', 'Campagne'],
      ['Soirée canapé ou soirée dehors ?', 'Canapé', 'Dehors'],
      ['Crêpes ou gaufres ?', 'Crêpes', 'Gaufres'],
      ['Tout prévoir ou improviser ?', 'Tout prévoir', 'Improviser'],
      ['Lever ou coucher de soleil ?', 'Lever', 'Coucher'],
      ['Pizza ou burger ?', 'Pizza', 'Burger'],
      ['Grosse fête ou petit dîner ?', 'Grosse fête', 'Petit dîner'],
      ['En avion : hublot ou couloir ?', 'Hublot', 'Couloir'],
      ['Douche chaude ou froide ?', 'Chaude', 'Froide'],
      ['Chocolat ou vanille ?', 'Chocolat', 'Vanille'],
      ['Road trip ou avion ?', 'Road trip', 'Avion'],
      ['Les spoilers : ok ou interdits ?', 'Ok', 'Interdits'],
    ]),
  },
  {
    id: 'nice',
    name: 'Que du love',
    icon: 'heart',
    color: '#e8a24b',
    prefix: 'Qui…',
    description: 'Que des compliments. Fais plaisir à quelqu’un.',
    questions: who([
      'sait toujours remonter le moral de tout le monde ?', 'donne les meilleurs conseils ?', 'fait les meilleurs câlins ?',
      'appellerais-tu en premier en cas d’urgence ?', 'a le meilleur rire ?', 'se souvient de l’anniversaire de tout le monde ?',
      'cuisine le mieux ?', 'est d’une fidélité à toute épreuve ?', 'a les meilleurs goûts musicaux ?',
      'ferait le meilleur parent ?', 'sait le mieux écouter ?', 'a toujours un truc à grignoter à partager ?',
      'a le sourire le plus contagieux ?', 'rend chaque voyage meilleur ?', 'fait les cadeaux les plus attentionnés ?',
      'a le plus d’imagination ?', 'a le meilleur style ?', 'est toujours là quand ça compte ?',
      'serait la personne idéale en coloc ?', 'met tout le monde à l’aise ?',
    ]),
  },
  {
    id: 'nice2',
    name: 'Que du love #2',
    icon: 'star',
    color: '#74b886',
    prefix: 'Qui…',
    description: 'Encore plus d’amour pour tes personnes préférées.',
    questions: who([
      'a le plus évolué cette année ?', 'a le plus grand cœur ?', 'est drôle sans en avoir l’air ?',
      't’inspire le plus ?', 'a le plus de courage ?', 'raconte les meilleures histoires ?',
      'aurait le droit de fouiller ton téléphone ?', 'a les meilleurs goûts en films ?', 'a le plus de patience ?',
      'pourrait dérider un chat grognon ?', 'tient toujours ses promesses ?', 'serait la meilleure compagnie en voyage ?',
      'fait les meilleures playlists ?', 'ferait le meilleur boss ?', 'ne juge jamais personne ?',
      'bosse le plus dur ?', 'mérite plus de reconnaissance ?', 'a les meilleures idées à 2 h du matin ?',
      'garde son calme sous pression ?', 'voudrais-tu dans ton équipe de quiz ?',
    ]),
  },
  {
    id: 'teams',
    name: 'Équipes',
    icon: 'flag',
    color: '#e0cc6a',
    prefix: 'Choisis ton camp',
    description: 'Divise le groupe sur les vraies questions de la vie.',
    questions: wyr([
      ['L’ananas sur la pizza', 'Team Oui', 'Team Non'],
      ['Dormir en chaussettes', 'Team Chaussettes', 'Team Pieds nus'],
      ['Les frites, c’est avec…', 'Team Ketchup', 'Team Mayo'],
      ['Pour les céréales', 'Céréales d’abord', 'Lait d’abord'],
      ['Le rouleau de PQ', 'Team Dessus', 'Team Dessous'],
      ['Un hot-dog, c’est un sandwich ?', 'Évidemment', 'Jamais'],
      ['Ta chambre, c’est plutôt…', 'Chaos créatif', 'Nickel'],
      ['Quand le réveil sonne', 'Team Snooze', 'Team Debout direct'],
      ['La douche, c’est…', 'Le matin', 'Le soir'],
      ['Lire sur…', 'Papier', 'Écran'],
      ['Ton téléphone est en…', 'Mode sombre', 'Mode clair'],
      ['Les messages, c’est en…', 'Vocaux', 'Écrits'],
      ['La pizza se mange…', 'Avec les mains', 'Couteau-fourchette'],
      ['Des glaçons dans ton verre ?', 'Plein', 'Aucun'],
      ['En voiture, tu mets…', 'Du karaoké', 'Des podcasts'],
      ['Nager dans…', 'La piscine', 'La mer'],
      ['Le meilleur cadeau', 'Un objet', 'Une expérience'],
      ['La fenêtre la nuit', 'Ouverte', 'Fermée'],
      ['Ton bureau d’ordi est…', 'Rangé', '1000 icônes'],
      ['Les vacances, c’est pour…', 'Visiter', 'Ne rien faire'],
    ]),
  },
  {
    id: 'scenarios',
    name: 'Le film de nous',
    icon: 'ghost',
    color: '#9aa0b4',
    prefix: 'Dans un film sur nous…',
    description: 'Des scénarios improbables avec ta bande en vedette.',
    questions: who([
      'qui survit le plus longtemps à l’apocalypse zombie ?', 'qui construit l’abri sur l’île déserte ?',
      'qui panique en premier quand on se perd en forêt ?', 'qui gagne l’émission de cuisine ?',
      'qui se lie d’amitié avec les extraterrestres en premier ?', 'qui sort de la maison hantée en hurlant ?',
      'qui est le cerveau du braquage ?', 'qui fonde une secte par accident ?',
      'qui évite l’amende après un excès de vitesse ?', 'qui tient le plus longtemps sans internet ?',
      'qui rentre de vacances avec un chien errant ?', 'qui gagne le jeu de culture générale ?',
      'qui se révèle être le méchant ?', 'qui fait virer le groupe d’un musée ?',
      'qui trouve le trésor caché ?', 'qui résout la dernière énigme de l’escape game ?',
      'qui devient pote avec tout l’avion ?', 'qui fait passer des snacks en douce au ciné ?',
      'qui part rejoindre le cirque ?', 'qui construit un robot pour faire ses corvées ?',
    ]),
  },
  {
    id: 'party',
    name: 'Soirée',
    icon: 'chick',
    color: '#d77aa0',
    prefix: 'Qui a le plus de chances de…',
    description: 'Parfait avant (ou après) une soirée ensemble.',
    questions: who([
      'rester le plus tard sur la piste ?', 'lancer un karaoké ?', 'prendre 300 photos ce soir ?',
      'devenir pote avec le DJ ?', 'commander une pizza à 2 h du matin ?', 'perdre sa veste ?', 's’endormir en premier ?',
      'raconter l’histoire la plus gênante ?', 'organiser la prochaine soirée ?', 'manger tous les snacks ?',
      'inventer un nouveau pas de danse ?', 's’éclipser en douce ?', 'prendre le contrôle de la playlist ?',
      'lancer un action ou vérité ?', 'venir en costume ?', 'mettre l’ambiance ?',
      'se réveiller en premier le lendemain ?', 'perdre sa voix à force de chanter ?', 'ramener un invité surprise ?',
      'passer toute la soirée dans la cuisine ?',
    ]),
  },
];

const PACKS = RAW_PACKS.map((pack) => ({
  ...pack,
  prefix: fr(pack.prefix),
  questions: pack.questions.map((q, i) => ({ ...q, text: fr(q.text), a: fr(q.a), b: fr(q.b), id: `${pack.id}-${i + 1}`, packId: pack.id })),
}));

const packIndex = new Map(PACKS.map((p) => [p.id, p]));
const questionIndex = new Map(PACKS.flatMap((p) => p.questions.map((q) => [q.id, q])));

const findPack = (id) => packIndex.get(id) || null;
const findQuestion = (id) => questionIndex.get(id) || null;

module.exports = { PACKS, findPack, findQuestion, fr };
