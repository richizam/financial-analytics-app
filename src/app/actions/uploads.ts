'use server'

import { postBackendForm } from '@/lib/python-backend'
import type { CsvMappingResponse, UploadCsvResult } from './types'

export async function uploadCsvAction(formData: FormData): Promise<UploadCsvResult> {
  return postBackendForm<UploadCsvResult>('/upload-csv', formData)
}

export async function suggestCsvMappingAction(formData: FormData): Promise<CsvMappingResponse> {
  return postBackendForm<CsvMappingResponse>('/ai/csv-mapping', formData)
}
