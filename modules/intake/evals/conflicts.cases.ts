/*
 * A6 conflict pre-screen eval (spec Section 6: at least 20 golden cases;
 * Phase 2 acceptance: "Conflict hits surface for known test collisions").
 * Synthetic people and businesses only.
 *
 * The roster is what the firm already knows: clients and prior enquiries (as
 * contacts) and the firm-maintained conflict list. Each case is a new
 * prospect, with the names they gave, and the roster names that must surface
 * (or none). A missed collision is the costly error, so every "hit" case
 * must pass; "clear" cases guard against flooding the reviewer.
 */

export type RosterContact = {
  fullName: string | null;
  companyName: string | null;
  client: boolean;
};
export type RosterParty = {
  name: string;
  kind: "person" | "organization";
  role: "client" | "adverse" | "related";
};

export const ROSTER_CONTACTS: RosterContact[] = [
  { fullName: "Margaret Okonkwo", companyName: null, client: true },
  { fullName: "Robert Delgado", companyName: null, client: true },
  { fullName: "Ava Lindqvist", companyName: "Hollis Creek Ranch LLC", client: true },
  { fullName: "Thanh Nguyen", companyName: null, client: true },
  { fullName: "Katherine O'Brien-Walsh", companyName: null, client: true },
  { fullName: "Jonathan Pemberton", companyName: null, client: false },
  { fullName: "Priya Raghunathan", companyName: "Raghunathan Imports Inc", client: false },
];

export const ROSTER_PARTIES: RosterParty[] = [
  { name: "Brightline Capital Partners LP", kind: "organization", role: "adverse" },
  { name: "Desmond Achterberg", kind: "person", role: "adverse" },
  { name: "Lucia Ferreira-Santos", kind: "person", role: "related" },
  { name: "Wexford Dental Group PLLC", kind: "organization", role: "client" },
  { name: "Elizabeth Marchetti", kind: "person", role: "adverse" },
];

export type ConflictCase = {
  name: string;
  prospect: { first: string; last: string; company?: string };
  answers?: Record<string, string>;
  /** Roster names that must appear among the hits. Empty: no hits at all. */
  expectHits: string[];
};

export const CONFLICT_CASES: ConflictCase[] = [
  // Known collisions: each must surface.
  {
    name: "exact client name",
    prospect: { first: "Margaret", last: "Okonkwo" },
    expectHits: ["Margaret Okonkwo"],
  },
  {
    name: "nickname of a client",
    prospect: { first: "Bob", last: "Delgado" },
    expectHits: ["Robert Delgado"],
  },
  {
    name: "client named as the other party, surname first",
    prospect: { first: "Carmen", last: "Ilves" },
    answers: { other_parties: "Delgado Robert" },
    expectHits: ["Robert Delgado"],
  },
  {
    name: "initial and surname of a client",
    prospect: { first: "Dana", last: "Whitcomb" },
    answers: { other_parties: "R Delgado" },
    expectHits: ["Robert Delgado"],
  },
  {
    name: "misspelled adverse party",
    prospect: { first: "Desmond", last: "Achterburg" },
    expectHits: ["Desmond Achterberg"],
  },
  {
    name: "adverse business, shortened",
    prospect: { first: "Tomasz", last: "Brezinski" },
    answers: { other_parties: "Brightline Capital" },
    expectHits: ["Brightline Capital Partners LP"],
  },
  {
    name: "client business without its suffix",
    prospect: { first: "Owen", last: "Marsh" },
    answers: { other_parties: "Hollis Creek Ranch" },
    expectHits: ["Hollis Creek Ranch LLC"],
  },
  {
    name: "hyphenated surname written without punctuation",
    prospect: { first: "Katherine", last: "OBrien Walsh" },
    expectHits: ["Katherine O'Brien-Walsh"],
  },
  {
    name: "nickname with hyphenated surname",
    prospect: { first: "Kate", last: "O'Brien-Walsh" },
    expectHits: ["Katherine O'Brien-Walsh"],
  },
  {
    name: "related party listed among co-owners",
    prospect: { first: "Mark", last: "Ruiz", company: "Ruiz Ferreira Holdings LLC" },
    answers: { owners: "Mark Ruiz and Lucia Ferreira Santos" },
    expectHits: ["Lucia Ferreira-Santos"],
  },
  {
    name: "firm client business named as counterparty",
    prospect: { first: "Hannah", last: "Ostrowski" },
    answers: { other_parties: "Wexford Dental Group" },
    expectHits: ["Wexford Dental Group PLLC"],
  },
  {
    name: "exact client name, common surname",
    prospect: { first: "Thanh", last: "Nguyen" },
    expectHits: ["Thanh Nguyen"],
  },
  {
    name: "prior enquiry named as executor, by nickname",
    prospect: { first: "Grace", last: "Albright" },
    answers: { named_executor: "Jon Pemberton" },
    expectHits: ["Jonathan Pemberton"],
  },
  {
    name: "prospect's business matches a prior enquiry's business",
    prospect: { first: "Sunil", last: "Mehta", company: "Raghunathan Imports" },
    expectHits: ["Raghunathan Imports Inc"],
  },
  {
    name: "adverse party with a typo in both names",
    prospect: { first: "Lena", last: "Park" },
    answers: { other_parties: "Elisabeth Marcheti" },
    expectHits: ["Elizabeth Marchetti"],
  },
  {
    name: "several parties, one collides",
    prospect: { first: "Iris", last: "Gallagher" },
    answers: { other_parties: "Northgate Supply Co; Desmond Achterberg; Peter Vance" },
    expectHits: ["Desmond Achterberg"],
  },
  // Near misses: nothing should surface.
  { name: "unrelated person", prospect: { first: "Maria", last: "Gonzalez" }, expectHits: [] },
  {
    name: "same first name as a client, different surname",
    prospect: { first: "Robert", last: "Delacroix" },
    expectHits: [],
  },
  {
    name: "same first name, unrelated surname",
    prospect: { first: "Margaret", last: "Oakley" },
    expectHits: [],
  },
  {
    name: "business sharing one generic word",
    prospect: { first: "Leo", last: "Brandt", company: "Brightwater Plumbing LLC" },
    expectHits: [],
  },
  {
    name: "same first name as an adverse party",
    prospect: { first: "Desmond", last: "Tutu" },
    expectHits: [],
  },
  {
    name: "answers that name nobody",
    prospect: { first: "Nora", last: "Fitzgerald" },
    answers: { other_parties: "none", owners: "just me" },
    expectHits: [],
  },
];
