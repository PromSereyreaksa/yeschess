// "Read more" text for every item: how to use it, and what's worth knowing.
export const TIPS = {
  // power-ups
  teleport: { how: 'Pick one of your pieces, then any empty square.', tip: 'Great for escaping a fork, or dropping a rook straight onto an open file.' },
  shield: { how: 'Pick one of your pieces (not the king).', tip: "For your opponent's next 2 turns it can't be captured or hit by weapons. An EMP strips it off." },
  rewind: { how: 'No target. Just press Play.', tip: "The board goes back to how it was before your opponent's last turn, then you move. Only works right after their turn." },
  clone: { how: 'Pick a pawn, knight, bishop or rook, then an empty square next to it.', tip: 'A free extra piece. A cloned knight near the enemy king is scary.' },
  mind: { how: 'Pick an enemy knight, bishop or rook, then where it moves.', tip: "Make their piece capture one of their own, or walk it into danger. Their king can't be taken this way." },
  swap: { how: 'Pick one of your pieces, then any other piece (yours or theirs, not a king).', tip: "Swap places with an enemy queen to drag it into your attack. Shielded enemies can't be swapped." },
  ghost: { how: 'Pick a bishop, rook or queen, then a square along its normal lines.', tip: 'It flies straight through blockers, so pawn walls stop nothing. It can still capture where it lands.' },
  freeze: { how: 'Pick an enemy piece (not the king).', tip: "It can't move for its next 2 turns. Freeze the attacker that's bothering you, or a key defender." },
  resurrect: { how: 'Pick a captured piece, then an empty square on your back two ranks. Pawns return to your pawn rank.', tip: 'Lost your queen? Bring her back.' },
  evolve: { how: 'Pick one of your pawns, then choose knight, bishop or rook.', tip: 'An instant cheap promotion. Turn a stuck pawn into a real attacker.' },
  // weapons
  laser: { how: 'Pick one of your pieces, then a target. The beam fires along the row or column.', tip: "It hits the first piece in that line, and only fires if that piece is an enemy. Your own pieces block it. Queens are fair game, kings and shielded pieces aren't." },
  rocket: { how: 'Pick any enemy piece except the king or queen.', tip: 'No line of sight needed, so it hits anywhere on the board. Shielded pieces are immune.' },
  mine: { how: 'Pick an empty square in the middle of the board (ranks 3 to 6).', tip: "Only you can see it. The next enemy piece that steps on it is destroyed. Kings set it off but survive. An enemy EMP wipes it." },
  emp: { how: 'Pick the center of a 3×3 blast.', tip: "Enemy pieces inside are stunned for a turn and lose their shields, enemy mines there are wiped, and your opponent can't use any items on their next turn." },
  shotgun: { how: 'Pick one of your pieces. Every enemy next to it gets blasted.', tip: 'Hits pawns, knights, bishops and rooks on all 8 sides. Queens, kings and shielded pieces survive. Best when you are surrounded.' },
  // cards
  reverse: { how: 'No target. Just press Play, then move.', tip: 'You get a bonus turn right away. Then your opponent gets two turns in a row.' },
  skip: { how: 'No target. Press Play, then make your move.', tip: "Your opponent's next turn is skipped, so you go again. It doesn't count if your move gives check." },
  double: { how: 'Press Play, then make two moves with two different pieces.', tip: 'No items on the second move. Great for setting up a two-piece attack in one go.' },
  shuffle: { how: 'No target. Just press Play.', tip: "Every pawn on the board, yours and theirs, jumps to a random square on its own rank. Pure chaos. Can't be used while you're in check." },
  steal: { how: 'Pick an enemy knight or bishop, or an enemy pawn in the middle of the board.', tip: 'It joins your side for good. Shielded pieces are safe from it.' },
  mimic: { how: 'No target. Just press Play.', tip: "You get a copy of a random item from your opponent's hand. They need to have at least one." },
  wildcard: { how: 'Press Play, then pick any power-up from the list.', tip: 'It turns into that power-up in your hand, ready to use.' },
  imposter: { how: 'Pick your queen, then the empty square next to her where the copy appears.', tip: 'Half the time the real queen jumps to the new square, so even the squares give nothing away. The fake can’t capture, a fake "check" makes it pop, and it fades after 6 turns. Only you see the mask badge on it.' },
  disguise: { how: 'Pick one of your pawns. Nobody else sees anything happen.', tip: 'It’s a real queen that looks like a pawn to your opponent. It stays hidden while it moves like a pawn. Moving like a queen, giving check or blocking one of their moves reveals it.' },
  // weapons
  thunder: { how: 'Pick an enemy piece (not the king or queen).', tip: 'Destroys it, and every enemy piece next to it is stunned for a turn and loses its shield.' },
  slash: { how: 'Pick one of your pieces. It cuts the 3 squares in front of it.', tip: 'Cuts down enemy pawns, knights and bishops in those squares. Great when they line up in front of your pawns.' },
  // legendaries
  hyperbeam: { how: 'Pick one of your pieces, then a direction (the first square that way).', tip: 'The beam goes all the way to the edge of the board and hits every enemy on the way, queens included. Your own pieces aren’t hurt.' },
  orbital: { how: 'Pick the center of a 3×3 area.', tip: 'Wipes out every enemy pawn, knight, bishop and rook in the area. Kings, queens and shielded pieces survive.' },
  zero: { how: 'Pick the center of a 3×3 area.', tip: 'Every enemy piece there is frozen for their next 3 turns and loses its shield. Freeze their whole defence at once.' },
  storm: { how: 'No target. Just press Play.', tip: 'Up to 3 random enemy pieces get struck by lightning. Never the king or queen.' },
  aegis: { how: 'Pick one of your pieces (not the king).', tip: 'It and every friendly piece around it are shielded for 2 enemy turns. Free action.' },
  ascension: { how: 'Pick one of your pawns.', tip: 'It becomes a queen on the spot. Uses your turn.' },
  shadowarmy: { how: 'No target. Just press Play.', tip: 'Your two strongest captured pieces rise again on your back ranks.' },
  timestop: { how: 'No target. Just press Play, then keep moving.', tip: 'You get two bonus turns in a row. A bonus turn is skipped if you give check, so set up first, strike last.' },
  hypnosis: { how: 'Pick an enemy knight, bishop or rook anywhere.', tip: 'It joins your side permanently. Shielded pieces resist.' },
};
