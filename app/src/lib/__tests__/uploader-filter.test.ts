import { buildUploaderOptions, filterByUploader } from '@/lib/uploader-filter';

describe('buildUploaderOptions', () => {
  const members = [
    { user_id: 'u-ruben', email: 'ruben@x.com', person_id: 'p-ruben' },
    { user_id: 'u-marc', email: 'marc.family@x.com', person_id: null },
    { user_id: 'u-ghost', email: null, person_id: null },
  ];
  const persons = [
    { id: 'p-ruben', name: 'Ruben' },
    { id: 'p-sindy', name: 'Sindy' },
  ];

  it('names members by linked person, then email prefix, then fallback', () => {
    const options = buildUploaderOptions(members, persons, 'Family member');
    expect(options).toEqual([
      { id: 'u-ruben', name: 'Ruben' },
      { id: 'u-marc', name: 'marc.family' },
      { id: 'u-ghost', name: 'Family member' },
    ]);
  });
});

describe('filterByUploader', () => {
  const recipes = [
    { id: 'r1', created_by: 'u-ruben' },
    { id: 'r2', created_by: 'u-marc' },
    { id: 'r3', created_by: null },
  ];

  it('keeps only the selected uploader', () => {
    expect(filterByUploader(recipes, 'u-ruben').map((r) => r.id)).toEqual(['r1']);
  });

  it('null means everyone', () => {
    expect(filterByUploader(recipes, null)).toHaveLength(3);
  });
});
