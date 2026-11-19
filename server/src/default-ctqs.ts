// Bibliothèque CTQ de démarrage — placeholder générique.
// À remplacer par les 23 CTQ du PQG-FUS lors de l'instanciation réelle
// (POST /api/ctqs ou script de seed dédié).
export const DEFAULT_CTQS: Array<{ code: string; label: string; family: string; regime: string }> = [
  { code: 'CTQ-PRO-01', label: 'Pouvoir de coupure (I²t adiabatique)', family: 'protection', regime: 'R3' },
  { code: 'CTQ-PRO-02', label: 'Temps-courant zone bout long', family: 'protection', regime: 'R4' },
  { code: 'CTQ-NOR-01', label: 'Résistance à froid', family: 'régime normal', regime: 'R3' },
  { code: 'CTQ-NOR-02', label: 'Échauffement en régime normal', family: 'régime normal', regime: 'R2' },
  { code: 'CTQ-MEC-01', label: 'Dimensions d`encombrement', family: 'mécanique/sécurité', regime: 'R2' },
  { code: 'CTQ-MEC-02', label: 'Couple de serrage / fixation', family: 'mécanique/sécurité', regime: 'R1' },
  { code: 'CTQ-INF-01', label: 'Marquage et lisibilité des références', family: 'information', regime: 'R1' },
  { code: 'CTQ-MAT-01', label: 'Conformité matières amont (certificats)', family: 'matières amont', regime: 'R2' },
];
