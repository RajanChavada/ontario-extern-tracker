// Name fragments of real Ontario hospitals and health networks.
// Demo specs may not attach invented deadlines, pay or vacancies to these names.
// This is a guard rail, not a registry: extend it when the tracker adds hospitals.
export const REAL_ORG_FRAGMENTS = [
  'alexandra hospital', 'alexandra marine', 'bluewater health', 'brampton civic', 'brant community', 'bruyère', 'bruyere',
  'cambridge memorial', 'camh', 'campbellford', 'chatham-kent', 'cheo', 'collingwood general', 'cornwall community',
  'credit valley', 'erie shores', 'etobicoke general', 'grand river hospital', 'grey bruce', 'guelph general',
  'haldimand war memorial', 'halton healthcare', 'hamilton health sciences', 'hawkesbury', 'headwaters',
  'health sciences north', 'holland bloorview', 'hôtel-dieu', 'hotel dieu', 'humber river', 'huron perth',
  'joseph brant', 'kingston health sciences', 'lake of the woods', 'lakeridge health', 'listowel', 'london health sciences',
  'mackenzie health', 'markham stouffville', 'michael garron', 'middlesex hospital', 'mississauga hospital', 'montfort',
  'mount sinai', 'muskoka algonquin', 'niagara health', 'norfolk general', 'north bay regional', 'north york general',
  'northumberland hills', 'oak valley health', 'orillia soldiers', 'osler', 'ottawa hospital', 'pembroke regional',
  'peterborough regional', 'quinte health', 'queensway carleton', 'queensway health centre', 'ross memorial',
  'royal victoria regional', 'runnymede', 'sault area hospital', 'scarborough health', 'sickkids', 'sick children',
  'sinai health', 'southlake', "st. joseph's", 'st joseph’s', "st. michael's", 'st. thomas elgin', 'stevenson memorial',
  'strathroy', 'sunnybrook', 'thunder bay regional', 'tillsonburg', 'toronto east health', 'toronto general',
  'toronto western', 'trillium health', 'uhn', 'unity health', 'university health network', 'waterloo regional health',
  'west haldimand', 'west nipissing', 'west parry sound', 'william osler', 'winchester district', 'windsor regional',
  "women's college", 'woodstock hospital', 'wrhn',
];

export function findRealOrg(text) {
  const t = String(text).toLowerCase();
  return REAL_ORG_FRAGMENTS.find((f) => new RegExp(`(^|[^a-z])${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(t)) ?? null;
}
