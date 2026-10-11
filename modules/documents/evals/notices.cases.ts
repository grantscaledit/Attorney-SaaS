import type { NoticeFields } from "../notice-parser";

/*
 * B3 golden cases (spec Section 6: at least 20 for B3). Synthetic notices
 * written in the layouts of common IRS and Texas Comptroller letters, with
 * fictional people and identifiers (SSNs in the 123-45-xxxx test pattern,
 * 9-digit numbers that are not real). Each case lists the fields a reviewer
 * would read off the page. VERIFY: a tax attorney should spot-check these
 * layouts against real notices before the firm relies on B3.
 */

export type NoticeCase = { name: string; text: string; expect: NoticeFields };

const irsHeader = (date: string) =>
  `Department of the Treasury\nInternal Revenue Service\nKansas City, MO 64999-0025\n\n${date}\n`;

export const NOTICE_CASES: NoticeCase[] = [
  {
    name: "CP2000 proposed changes",
    text: `${irsHeader("September 30, 2026")}Notice CP2000\nTax year 2024\nSocial Security number 123-45-6789\nTo contact us 1-800-829-0922\n\nProposed changes to your 2024 Form 1040\nAmount due: $3,214.00\nWe need to hear from you by October 30, 2026.\nRespond by: October 30, 2026\nTaxpayer: PAT SAMPLE`,
    expect: {
      agency: "IRS",
      noticeType: "CP2000",
      taxYears: ["2024"],
      amountDue: "3,214.00",
      noticeDate: "2026-09-30",
      respondBy: "2026-10-30",
    },
  },
  {
    name: "CP14 balance due",
    text: `${irsHeader("Notice date: August 18, 2026")}CP14\nTax year 2023\nTaxpayer ID: XXX-XX-4321\nAmount due: $1,082.55\nPay by: September 8, 2026\nBilling summary\nAmount you owed $950.00\nFailure-to-pay penalty $32.55\nInterest charged $100.00`,
    expect: {
      agency: "IRS",
      noticeType: "CP14",
      taxYears: ["2023"],
      amountDue: "1,082.55",
      noticeDate: "2026-08-18",
      respondBy: "2026-09-08",
    },
  },
  {
    name: "CP504 intent to levy",
    text: `${irsHeader("July 6, 2026")}Notice CP504\nTax period: December 31, 2022\nSSN 123-45-1111\nAmount due immediately: $8,640.12\nNotice of intent to seize (levy) your property or rights to property.\nIf you don't pay $8,640.12 by July 27, 2026, we may seize your state income tax refund.`,
    expect: {
      agency: "IRS",
      noticeType: "CP504",
      taxYears: ["2022"],
      amountDue: "8,640.12",
      noticeDate: "2026-07-06",
      respondBy: "2026-07-27",
    },
  },
  {
    name: "LT11 final notice",
    text: `Department of the Treasury\nInternal Revenue Service\nP.O. Box 145566\nCincinnati, OH 45250-5566\n\nDate of this letter: June 1, 2026\nLetter LT11\nFinal notice of intent to levy and notice of your right to a hearing\nTax periods: 2020, 2021\nTotal amount you owe: $22,410.00\nCall us immediately. You have the right to request a Collection Due Process hearing.\nRequest a hearing by: July 1, 2026`,
    expect: {
      agency: "IRS",
      noticeType: "LT11",
      taxYears: ["2020", "2021"],
      amountDue: "22,410.00",
      noticeDate: "2026-06-01",
      respondBy: "2026-07-01",
    },
  },
  {
    name: "Letter 1058 final notice",
    text: `${irsHeader("Letter date: 05/12/2026")}Letter 1058\nFinal notice\nNotice of intent to levy and your right to a hearing\nTax years 2019 through 2021\nAmount due: $14,900.40\nIf you do not respond by June 11, 2026 we may levy.`,
    expect: {
      agency: "IRS",
      noticeType: "Letter 1058",
      taxYears: ["2019", "2020", "2021"],
      amountDue: "14,900.40",
      noticeDate: "2026-05-12",
      respondBy: "2026-06-11",
    },
  },
  {
    name: "CP3219A notice of deficiency",
    text: `${irsHeader("March 3, 2026")}Notice CP3219A\nNotice of deficiency\nTax year 2023\nDeficiency amount due: $5,500.00\nLast day to petition the Tax Court: June 1, 2026\nTaxpayer identification number 123-45-2222`,
    expect: {
      agency: "IRS",
      noticeType: "CP3219A",
      taxYears: ["2023"],
      amountDue: "5,500.00",
      noticeDate: "2026-03-03",
      respondBy: "2026-06-01",
    },
  },
  {
    name: "CP501 reminder",
    text: `${irsHeader("Notice date October 2, 2026")}CP501\nReminder, you have an unpaid amount due\nTax year 2024\nAmount due: $640.00\nPay by: October 23, 2026`,
    expect: {
      agency: "IRS",
      noticeType: "CP501",
      taxYears: ["2024"],
      amountDue: "640.00",
      noticeDate: "2026-10-02",
      respondBy: "2026-10-23",
    },
  },
  {
    name: "CP59 unfiled return",
    text: `${irsHeader("September 9, 2026")}Notice CP59\nWe have no record of receiving your tax return for tax year 2025\nSSN 123-45-3333\nRespond by September 30, 2026\nFile your 2025 Form 1040 immediately.`,
    expect: {
      agency: "IRS",
      noticeType: "CP59",
      taxYears: ["2025"],
      amountDue: null,
      noticeDate: "2026-09-09",
      respondBy: "2026-09-30",
    },
  },
  {
    name: "CP90 final notice of intent to levy",
    text: `${irsHeader("Notice date: 04/20/2026")}CP90\nFinal notice of intent to levy and notice of your right to a hearing\nTax periods 2021 and 2022\nAmount you owe: $31,005.88\nRespond by: May 20, 2026`,
    expect: {
      agency: "IRS",
      noticeType: "CP90",
      taxYears: ["2021", "2022"],
      amountDue: "31,005.88",
      noticeDate: "2026-04-20",
      respondBy: "2026-05-20",
    },
  },
  {
    name: "Letter 525 audit report",
    text: `${irsHeader("February 10, 2026")}Letter 525\nGeneral 30-day letter\nTax year 2022\nProposed balance due: $7,250.00\nIf you do not respond by March 12, 2026, we will process the adjustments.\nEmployer identification number: 12-3456789`,
    expect: {
      agency: "IRS",
      noticeType: "Letter 525",
      taxYears: ["2022"],
      amountDue: "7,250.00",
      noticeDate: "2026-02-10",
      respondBy: "2026-03-12",
    },
  },
  {
    name: "CP11 math error",
    text: `${irsHeader("Notice date August 3, 2026")}Notice CP11\nChanges to your 2025 Form 1040\nAmount due: $412.00\nPay by: August 24, 2026\nIf you disagree, contact us within 60 days.`,
    expect: {
      agency: "IRS",
      noticeType: "CP11",
      taxYears: ["2025"],
      amountDue: "412.00",
      noticeDate: "2026-08-03",
      respondBy: "2026-08-24",
    },
  },
  {
    name: "CP523 installment agreement default",
    text: `${irsHeader("July 28, 2026")}CP523\nNotice of intent to terminate your installment agreement\nTax years 2020 - 2022\nBalance due: $18,330.00\nDue date: August 18, 2026`,
    expect: {
      agency: "IRS",
      noticeType: "CP523",
      taxYears: ["2020", "2021", "2022"],
      amountDue: "18,330.00",
      noticeDate: "2026-07-28",
      respondBy: "2026-08-18",
    },
  },
  {
    name: "CP2501 income mismatch",
    text: `${irsHeader("June 15, 2026")}Notice CP2501\nTax year 2024\nWe found a difference between the income you reported and the income reported to us.\nPlease respond by July 15, 2026.\nCall 1-800-829-0922.`,
    expect: {
      agency: "IRS",
      noticeType: "CP2501",
      taxYears: ["2024"],
      amountDue: null,
      noticeDate: "2026-06-15",
      respondBy: "2026-07-15",
    },
  },
  {
    name: "CP161 business balance due",
    text: `${irsHeader("May 4, 2026")}Notice CP161\nEmployer ID number 98-7654321\nTax period: December 31, 2025\nForm 941\nAmount due: $2,980.10\nPay by May 25, 2026`,
    expect: {
      agency: "IRS",
      noticeType: "CP161",
      taxYears: ["2025"],
      amountDue: "2,980.10",
      noticeDate: "2026-05-04",
      respondBy: "2026-05-25",
    },
  },
  {
    name: "CP71C annual reminder, no response date",
    text: `${irsHeader("Notice date: November 2, 2026")}CP71C\nAnnual reminder of balance due taxes\nTax years 2016, 2017\nAmount due: $9,120.00`,
    expect: {
      agency: "IRS",
      noticeType: "CP71C",
      taxYears: ["2016", "2017"],
      amountDue: "9,120.00",
      noticeDate: "2026-11-02",
      respondBy: null,
    },
  },
  {
    name: "Letter 3172 federal tax lien filed",
    text: `${irsHeader("January 22, 2026")}Letter 3172\nNotice of federal tax lien filing and your right to a hearing\nTax periods: 2018, 2019\nUnpaid balance: amount due $40,212.00\nLast day to request a hearing: March 2, 2026`,
    expect: {
      agency: "IRS",
      noticeType: "Letter 3172",
      taxYears: ["2018", "2019"],
      amountDue: "40,212.00",
      noticeDate: "2026-01-22",
      respondBy: "2026-03-02",
    },
  },
  {
    name: "Texas Comptroller audit notice",
    text: `Glenn Hegar\nTexas Comptroller of Public Accounts\nP.O. Box 13528 Austin, TX 78711\n\nDate of notice: September 1, 2026\nNotice of audit\nSales and use tax\nTaxpayer number 1-23-4567890-1\nAudit period: January 1, 2022 through December 31, 2024\nPlease respond by September 30, 2026.`,
    expect: {
      agency: "Texas Comptroller",
      noticeType: null,
      taxYears: [],
      amountDue: null,
      noticeDate: "2026-09-01",
      respondBy: "2026-09-30",
    },
  },
  {
    name: "Texas Comptroller franchise tax delinquency",
    text: `Texas Comptroller of Public Accounts\ncomptroller.texas.gov\n\nNotice date: 06/02/2026\nFranchise tax: notice of delinquency\nReport year 2026\nAmount due: $1,450.00\nDue date: July 2, 2026\nFailure to file may result in forfeiture of the entity's right to transact business.`,
    expect: {
      agency: "Texas Comptroller",
      noticeType: null,
      taxYears: [],
      amountDue: "1,450.00",
      noticeDate: "2026-06-02",
      respondBy: "2026-07-02",
    },
  },
  {
    name: "CP2000 with full SSN and DOB in the text",
    text: `${irsHeader("October 5, 2026")}Notice CP2000\nTax year 2025\nTaxpayer: SAMPLE, ALEX   SSN: 123-45-6789   Date of birth: 04/12/1980\nBank account 000123456789 routing 111000025\nAmount due: $1,999.00\nRespond by November 4, 2026`,
    expect: {
      agency: "IRS",
      noticeType: "CP2000",
      taxYears: ["2025"],
      amountDue: "1,999.00",
      noticeDate: "2026-10-05",
      respondBy: "2026-11-04",
    },
  },
  {
    name: "Abbreviated months and no colon labels",
    text: `${irsHeader("Notice date Sept. 14, 2026")}CP503\nSecond reminder\nTax year 2024\nAmount due $725.40\nPay by Oct. 5, 2026`,
    expect: {
      agency: "IRS",
      noticeType: "CP503",
      taxYears: ["2024"],
      amountDue: "725.40",
      noticeDate: "2026-09-14",
      respondBy: "2026-10-05",
    },
  },
  {
    name: "Not a notice: bank statement",
    text: `First Example Bank\nStatement period: August 1, 2026 - August 31, 2026\nAccount ending 4455\nBeginning balance $4,210.00\nEnding balance $3,980.00`,
    expect: {
      agency: null,
      noticeType: null,
      taxYears: [],
      amountDue: null,
      noticeDate: null,
      respondBy: null,
    },
  },
];
