// Synthetic values only. Calendar dates are fixture wall-clock strings and are
// not a decision about the timezone of SQL datetime in the actual database.
export function bangkokToday(now = new Date()) {
  return new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);
}

export function makeFixtures(day) {
  return [
    { ID: 901, ProjectName: 'ตัวอย่าง · Rewards Portal', Owner: 'ทีมตัวอย่าง A', TargetDate: `${day} 15:30:00`, VersionNumber: 'demo-2.4.0', Status: 0, IsPrepared: true, CompletedDate: null },
    { ID: 902, ProjectName: 'ตัวอย่าง · Payment Service', Owner: 'ทีมตัวอย่าง B', TargetDate: `${day} 14:00:00`, VersionNumber: 'demo-1.8.2', Status: 7, IsPrepared: false, CompletedDate: null },
    { ID: 903, ProjectName: 'ตัวอย่าง · Customer App', Owner: 'ทีมตัวอย่าง C', TargetDate: `${day} 11:00:00`, VersionNumber: 'demo-3.1.0', Status: -1, IsPrepared: true, CompletedDate: `${day} 11:45:00` },
    { ID: 904, ProjectName: 'ตัวอย่าง · Rewards Portal', Owner: null, TargetDate: `${day} 09:00:00`, VersionNumber: null, Status: null, IsPrepared: null, CompletedDate: null }
  ];
}

export function filterFixtures(rows, filters) {
  return rows.filter(row => {
    const day = row.TargetDate.slice(0, 10);
    return day >= filters.from && day <= filters.to &&
      (!filters.project || row.ProjectName === filters.project) &&
      (!filters.status || filters.status === 'unknown' || row.Status === Number(filters.status)) &&
      (!filters.q || [row.ProjectName, row.VersionNumber].some(value => String(value || '').toLocaleLowerCase('th').includes(filters.q.toLocaleLowerCase('th'))));
  });
}
