export const sample = {
  period: { start: '2026-03-01', end: '2026-03-03' },
  bioEmployees: [{ empCode: '101', name: 'Moath Alghoniman', entity: 'MP KSA' }],
  punches: [
    { empCode: '101', punchTime: '2026-03-01 06:00:00', state: 'in' },
    { empCode: '101', punchTime: '2026-03-01 16:30:00', state: 'out' }, // 630
    { empCode: '101', punchTime: '2026-03-03 06:00:00', state: 'in' },
    { empCode: '101', punchTime: '2026-03-03 15:00:00', state: 'out' }, // 540
  ],
  rosterAoa: [
    ['Employee ID', 'Name', '2026-03-01', '2026-03-02', '2026-03-03'],
    ['101', 'Moath', '9', 'OFF', '9'],
  ],
  masterfile: [{ empId: '101', name: 'Alghoniman Moath', entity: 'Luqmat' }],
  zelt: [{ empId: '101', name: 'Moath Alghoniman', entity: 'Luqmat' }],
};
