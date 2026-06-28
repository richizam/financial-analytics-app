import type { CompanyOverview } from '@/app/actions'

export function overviewRucs(companies: CompanyOverview[]): string[] {
  return companies.map(company => company.ruc)
}

export function overviewPeriodsByRuc(companies: CompanyOverview[]): Record<string, string[]> {
  return Object.fromEntries(
    companies.map(company => [company.ruc, [...(company.periods ?? [])].sort()]),
  )
}

export function overviewCompanyNames(companies: CompanyOverview[]): Record<string, string> {
  return Object.fromEntries(
    companies.map(company => [company.ruc, company.razonSocial?.trim() || company.ruc]),
  )
}
