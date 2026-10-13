# Yamaha MusicCast

Pilotez vos appareils Yamaha MusicCast depuis Gladys : amplis audio-vidéo, barres de son, enceintes
réseau et lecteurs réseau. Tout reste sur votre réseau local : l'intégration parle à chaque appareil
par l'API officielle Yamaha Extended Control, sans compte ni cloud.

> **Développée sans le matériel : vos retours sont bienvenus.** Cette intégration a été écrite à
> partir de la spécification publique Yamaha Extended Control et des réponses relevées par les
> projets libres qui pilotent ces appareils, sans appareil MusicCast sous la main. Si quelque chose
> ne se comporte pas comme décrit, ouvrez une issue sur le
> [dépôt GitHub](https://github.com/guim31/gladys-musiccast/issues) en précisant votre modèle.

Cette intégration est non affiliée à Yamaha Corporation. MusicCast est une marque de Yamaha
Corporation.

## Ce que vous obtenez

- **Un appareil Gladys par zone** : la zone principale, et la zone 2, 3 ou 4 des amplis qui en ont,
  chacune allumée, réglée et commutée indépendamment.
- **Marche/veille, volume et sourdine** de chaque zone. Le volume est affiché en pourcentage de la
  plage de la zone, l'échelle du widget musique de Gladys.
- **Entrée** : la liste des entrées de la zone (HDMI, tuner, Spotify, Net Radio, AirPlay...), avec
  les noms que vous leur avez donnés sur l'appareil.
- **Mode son** (programme sonore, DSP) sur les zones qui en ont.
- **Lecture** des sources réseau : lecture, pause, précédent, suivant, état de lecture, et le
  titre, l'artiste et l'album en cours.
- **Favoris** (presets) : la liste des favoris enregistrés sur l'appareil, pour en rappeler un.
- Un **widget** de tableau de bord par zone, un **déclencheur de scène** « un titre démarre » et
  deux **actions de scène** : rappeler un favori, choisir l'entrée.

## Prérequis

- Gladys 5.1.0 ou plus récent.
- Un appareil Yamaha compatible MusicCast (il apparaît dans l'application MusicCast), sur le même
  réseau local que Gladys.
- Pour piloter un appareil en veille, activez sa **veille réseau** (Network Standby, dans les
  réglages « Réseau » de l'appareil ou de l'application MusicCast). Sans elle, un appareil en
  veille ne répond plus.
- Une adresse IP fixe pour chaque appareil (une réservation DHCP dans votre box) est conseillée.
  L'intégration retrouve un appareil après un changement d'adresse, mais jusqu'à 10 minutes plus
  tard.

## Configuration

### Réglages

| Champ                              | Rôle                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Adresses IP (facultatif)           | Adresses des appareils que la recherche réseau ne trouve pas, séparées par des virgules.                                                   |
| Rafraîchissement quand allumé      | Fréquence de lecture d'un appareil quand une de ses zones est allumée : 5, 10, 15 ou 30 secondes. En veille, ou sans réponse, 30 secondes. |
| Langue des noms de fonctionnalités | Noms donnés aux fonctionnalités des zones ajoutées ensuite, et langue des messages des actions de scène.                                   |

### Trouver les appareils

Au démarrage, et à chaque clic sur **Scanner** dans l'onglet Découverte, Gladys cherche sur le
réseau les lecteurs multimédias UPnP (SSDP) pour le compte de l'intégration ; l'intégration garde
ceux qui déclarent l'API Yamaha Extended Control. Le bouton **Rechercher les appareils MusicCast**
de la page de configuration fait de même et vous dit ce qu'il a trouvé, quelles adresses n'ont pas
répondu et quelles adresses saisies ne sont pas valides.

Si un appareil n'est pas trouvé (réseau qui bloque le multicast, autre sous-réseau), saisissez son
adresse IP dans la configuration.

### Ajouter les zones

Chaque zone apparaît dans l'onglet **Découverte**, nommée d'après l'appareil (« Salon ») et la zone
(« Salon Zone2 »). Cliquez sur **Ajouter à Gladys** pour celles que vous voulez. Seules les zones
ajoutées à Gladys sont lues régulièrement.

## Appareils

### Fonctionnalités d'une zone

| Fonctionnalité        | Type dans Gladys               | Remarques                                                                                              |
| --------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Alimentation          | Interrupteur                   | Allumé / veille.                                                                                       |
| Volume                | Volume de la musique (0-100 %) | Pourcentage de la plage de la zone (0 à 161 pas sur un ampli, 0 à 60 sur une enceinte...).             |
| Sourdine              | Interrupteur                   |                                                                                                        |
| Entrée                | Sélection                      | Les entrées de la zone, avec les noms donnés sur l'appareil.                                           |
| Mode son              | Sélection                      | Seulement sur les zones à programmes sonores (amplis, barres de son).                                  |
| Favori                | Sélection                      | Rappelle un favori enregistré ; affiche le dernier rappelé depuis Gladys jusqu'au changement d'entrée. |
| Lecture, Pause        | Boutons musique                | Sources réseau seulement. Pause arrête une radio en direct.                                            |
| Précédent, Suivant    | Boutons musique                | Sources réseau seulement.                                                                              |
| État de lecture       | État de lecture musique        | En lecture / à l'arrêt.                                                                                |
| Titre, Artiste, Album | Texte                          | Ce que joue une source réseau ; « — » sinon.                                                           |

Les fonctionnalités de lecture n'existent que sur les appareils dotés d'un module réseau, partagé
par toutes les zones d'un appareil : sur une zone qui écoute une autre entrée (HDMI, tuner...), les
boutons de lecture sont refusés pour ne pas mettre en pause la musique d'une autre zone.

Les zones fonctionnent aussi avec la boîte **Musique** du tableau de bord de Gladys (lecture,
pause, précédent, suivant et volume).

### Rafraîchissement

L'appareil sait pousser ses changements, mais seulement vers un port du conteneur de
l'intégration, que Gladys n'expose pas au réseau. L'intégration lit donc elle-même chaque appareil,
sans dépendre de l'interrogation de Gladys : toutes les 5 secondes par défaut quand une zone est
allumée, toutes les 30 secondes en veille. Une lecture, c'est une requête par zone ajoutée, plus une
pour ce qui joue quand une zone écoute une source réseau. Yamaha ne publie aucun quota de requêtes
pour cette API locale ; l'application MusicCast officielle lit les appareils à un rythme comparable.
Les favoris sont relus toutes les 5 minutes.

Seules les valeurs qui ont changé sont envoyées à Gladys, plus un rappel toutes les 6 heures pour
qu'une valeur stable ne paraisse jamais périmée.

## Widget de tableau de bord

Le widget **MusicCast** montre une zone (à choisir dans ses réglages) :

- ce qui joue (titre, artiste, album) sur une source réseau ;
- le volume, en direct ;
- l'alimentation, l'entrée et le mode son, et « Sourdine » quand le son est coupé ;
- jusqu'à quatre boutons : allumer / mettre en veille, lecture ou pause, titre suivant, sourdine.

## Déclencheur de scène

**MusicCast : un titre démarre** se déclenche quand la lecture démarre, ou quand le titre change,
sur une source réseau (Spotify, Net Radio, AirPlay, serveur...). Vous pouvez le limiter à une zone.
La scène reçoit en variables le titre, l'artiste, l'album et le nom de l'entrée. Il ne se déclenche
pas pour ce qui jouait déjà au démarrage de l'intégration.

## Actions de scène

- **Rappeler un favori MusicCast** : joue le favori numéro N (1 à 40) sur une zone, comme les
  touches de la télécommande. La zone s'allume. Sortie : le nom du favori.
- **Choisir l'entrée MusicCast** : passe une zone sur une entrée, donnée par son identifiant
  (`hdmi1`, `tuner`, `spotify`, `net_radio`, `airplay`...) ou par le nom affiché sur l'appareil
  (« Apple TV »). La zone s'allume d'abord. Sortie : le nom de l'entrée. Une entrée inconnue échoue
  avec la liste des entrées de la zone.

Pour éteindre une zone ou régler son volume dans une scène, utilisez l'action habituelle
**Contrôler un appareil** sur ses fonctionnalités Alimentation et Volume.

## Exemples de scènes

- **Radio-réveil** : à 7 h en semaine, rappeler le favori 1 (votre radio du matin) sur l'enceinte
  de la chambre, puis régler son volume à 20 %.
- **Soirée film** : quand la télé s'allume, choisir l'entrée `hdmi1` sur l'ampli du salon et passer
  le « Mode son » sur un programme cinéma.
- **Départ de la maison** : quand la dernière personne part, mettre toutes les zones en veille.
- **En cours de lecture** : quand un titre démarre dans la cuisine, vous envoyer
  « {{triggerEvent.data.title}} — {{triggerEvent.data.artist}} ».

## Dépannage

- **Aucun appareil dans l'onglet Découverte** : cliquez sur **Rechercher les appareils MusicCast**
  dans la configuration. Si rien n'est trouvé, saisissez l'adresse IP de l'appareil (affichée dans
  l'application MusicCast, Réglages → appareil → Réseau). Vérifiez que
  `http://<adresse>/YamahaExtendedControl/v1/system/getDeviceInfo` s'ouvre dans un navigateur de
  votre réseau : la page doit afficher `"response_code":0`.
- **La zone est « injoignable »** : l'appareil est débranché, hors du réseau, ou en veille sans
  veille réseau. L'intégration réessaie toutes les 30 secondes et relance une recherche réseau
  toutes les 10 minutes (nouvelle adresse DHCP).
- **Une commande est refusée** : certaines commandes sont bloquées tant que la zone est en veille
  (le volume, par exemple), et certains modèles refusent les fonctions qu'ils n'ont pas. Allumez
  d'abord la zone.
- **Lecture, pause ou suivant ne font rien sur une zone** : ces boutons n'agissent que sur les
  sources réseau. Choisissez d'abord une entrée réseau.
- **Journaux** : l'intégration n'écrit que le démarrage, les appareils trouvés, perdus et revenus,
  et une ligne par commande. Positionnez la variable d'environnement `LOG_LEVEL=debug` pour voir
  chaque lecture.

## Limites

- Le **multiroom (MusicCast Link)** n'est pas couvert : créer ou quitter un groupe se fait dans
  l'application MusicCast. Une zone qui suit un groupe affiche l'entrée « MusicCast Link ».
- Le tuner (FM/DAB) n'est pas piloté au-delà de sa sélection comme entrée ou du rappel d'un
  favori ; sa station n'est pas affichée comme titre.
- L'appareil ne dit pas quel favori joue : la liste Favori montre le dernier rappelé depuis Gladys.
- Les changements sont vus à la lecture suivante (5 secondes par défaut), pas instantanément.
- Les noms des fonctionnalités sont figés à l'ajout d'une zone dans Gladys ; changer la langue
  ensuite ne vaut que pour les zones ajoutées après.
- Développée sans le matériel : les réponses viennent de la spécification Yamaha et de projets
  libres. Vos retours aident.
