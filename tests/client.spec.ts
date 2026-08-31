import { describe, expect, it, vi } from 'vitest'
import { GoogleDriveClient } from '../src/client.ts'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function requestInit(fetchImpl: ReturnType<typeof vi.fn>, callIndex = 0): RequestInit {
  return (fetchImpl.mock.calls[callIndex] as unknown as [string, RequestInit])[1]
}

describe('GoogleDriveClient', () => {
  it('uses a static access token when provided', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ files: [], nextPageToken: '' }))
    const client = new GoogleDriveClient({ accessToken: 'ya29.static', fetchImpl })

    const result = await client.listFiles()

    expect(result.items).toHaveLength(0)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/files')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer ya29.static')
  })

  it('refreshes access token and caches it', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'ya29.refresh', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ files: [], nextPageToken: '' }))
    const client = new GoogleDriveClient({ clientId: 'cid', clientSecret: 'csecret', refreshToken: 'rtok', fetchImpl })

    const auth = await client.authTest()
    expect(auth).toMatchObject({ ok: true, authMethod: 'refresh_token' })
    await client.listFiles()

    expect(fetchImpl.mock.calls.length).toBe(2)
    const [tokenUrl, tokenInit] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(tokenUrl).toBe('https://oauth2.googleapis.com/token')
    expect(String(tokenInit.body)).toContain('grant_type=refresh_token')
  })

  it('lists files with query and pagination', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      files: [
        { id: 'file_1', name: 'Report', mimeType: 'application/pdf', modifiedTime: '2026-08-01T00:00:00Z', trashed: false },
        { id: 'file_2', name: 'Notes', mimeType: 'text/plain', modifiedTime: '2026-08-02T00:00:00Z', trashed: false },
      ],
      nextPageToken: 'page_2',
    }))
    const client = new GoogleDriveClient({ accessToken: 'ya29.static', fetchImpl })
    const result = await client.listFiles({ query: "name contains 'Report'", pageSize: 2, pageToken: 'page_1', orderBy: 'modifiedTime desc' })

    expect(result.nextPageToken).toBe('page_2')
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toMatchObject({ id: 'file_1', name: 'Report', mimeType: 'application/pdf' })
    const [url] = fetchImpl.mock.calls[0] as unknown as [string]
    expect(url).toContain('q=name+contains+%27Report%27')
    expect(url).toContain('pageSize=2')
    expect(url).toContain('pageToken=page_1')
    expect(url).toContain('orderBy=modifiedTime+desc')
  })

  it('gets file metadata by ID', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      id: 'file_1',
      name: 'Report',
      mimeType: 'application/pdf',
      description: 'Quarterly report',
      webViewLink: 'https://drive.google.com/file/d/file_1/view',
      parents: ['root'],
      owners: [{ displayName: 'Alice', emailAddress: 'alice@example.com' }],
    }))
    const client = new GoogleDriveClient({ accessToken: 'ya29.static', fetchImpl })
    const file = await client.getFile('file_1')

    expect(file).toMatchObject({ id: 'file_1', name: 'Report', description: 'Quarterly report' })
    const [url] = fetchImpl.mock.calls[0] as unknown as [string]
    expect(url).toContain('/files/file_1')
  })

  it('exports a Google Workspace file', async () => {
    const fetchImpl = vi.fn(async () => new Response('hello export', { status: 200, headers: { 'content-type': 'text/plain' } }))
    const client = new GoogleDriveClient({ accessToken: 'ya29.static', fetchImpl })
    const result = await client.exportFile('doc_1', { exportMimeType: 'text/plain', supportsAllDrives: true })

    expect(result).toMatchObject({ fileId: 'doc_1', exportMimeType: 'text/plain', encoding: 'text', content: 'hello export', contentLength: 12 })
    const [url] = fetchImpl.mock.calls[0] as unknown as [string]
    expect(url).toContain('/files/doc_1/export')
    expect(url).toContain('mimeType=text%2Fplain')
    expect(url).toContain('supportsAllDrives=true')
  })

  it('exports a file as base64 for binary MIME types', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'application/pdf' } }))
    const client = new GoogleDriveClient({ accessToken: 'ya29.static', fetchImpl })
    const result = await client.exportFile('doc_1', { exportMimeType: 'application/pdf', responseEncoding: 'base64' })

    expect(result).toMatchObject({ fileId: 'doc_1', exportMimeType: 'application/pdf', encoding: 'base64', content: 'AQID', contentLength: 4 })
    const [url] = fetchImpl.mock.calls[0] as unknown as [string]
    expect(url).toContain('mimeType=application%2Fpdf')
  })

  it('lists and gets shared drives', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ drives: [{ id: 'drive_1', name: 'Team Drive', createdTime: '2026-08-01T00:00:00Z', hidden: false }], nextPageToken: 'next' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'drive_1', name: 'Team Drive', createdTime: '2026-08-01T00:00:00Z', hidden: false }))
    const client = new GoogleDriveClient({ accessToken: 'ya29.static', fetchImpl })

    const list = await client.listSharedDrives({ pageSize: 10, query: "name contains 'Team'", useDomainAdminAccess: true })
    const drive = await client.getSharedDrive('drive_1')

    expect(list).toMatchObject({ nextPageToken: 'next' })
    expect(list.items[0]).toMatchObject({ id: 'drive_1', name: 'Team Drive' })
    expect(drive).toMatchObject({ id: 'drive_1', name: 'Team Drive' })
    const [listUrl] = fetchImpl.mock.calls[0] as unknown as [string]
    const [getUrl] = fetchImpl.mock.calls[1] as unknown as [string]
    expect(listUrl).toContain('/drives')
    expect(listUrl).toContain('useDomainAdminAccess=true')
    expect(getUrl).toContain('/drives/drive_1')
  })

  it('reads Google Docs text', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      documentId: 'doc_1', title: 'Doc Title', revisionId: 'rev_1',
      tabs: [{
        tabProperties: { tabId: 'tab_1', title: 'Tab 1', index: 0 },
        documentTab: { body: { content: [{ paragraph: { elements: [{ textRun: { content: 'Hello doc\n' } }] } }] } },
      }],
    }))
    const client = new GoogleDriveClient({ accessToken: 'ya29.static', fetchImpl })
    const doc = await client.getDocument('doc_1')

    expect(doc).toMatchObject({ documentId: 'doc_1', title: 'Doc Title', revisionId: 'rev_1', text: 'Hello doc', tabCount: 1 })
    expect(doc.tabs[0]).toMatchObject({ tabId: 'tab_1', title: 'Tab 1', textLength: 9 })
    const [url] = fetchImpl.mock.calls[0] as unknown as [string]
    expect(url).toContain('https://docs.googleapis.com/v1/documents/doc_1')
    expect(url).toContain('includeTabsContent=true')
  })

  it('reads Google Sheets metadata and values', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        spreadsheetId: 'sheet_1', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet_1',
        properties: { title: 'Budget', locale: 'en_US', timeZone: 'Etc/UTC' },
        sheets: [{ properties: { sheetId: 0, title: 'Sheet1', index: 0, sheetType: 'GRID', gridProperties: { rowCount: 100, columnCount: 20, frozenRowCount: 1 } } }],
      }))
      .mockResolvedValueOnce(jsonResponse({ range: 'Sheet1!A1:B2', majorDimension: 'ROWS', values: [['Name', 'Cost'], ['Server', '100']] }))
    const client = new GoogleDriveClient({ accessToken: 'ya29.static', fetchImpl })

    const metadata = await client.getSpreadsheet('sheet_1', { ranges: ['Sheet1!A1:B2'], includeGridData: false })
    const values = await client.getSheetValues('sheet_1', 'Sheet1!A1:B2')

    expect(metadata).toMatchObject({ spreadsheetId: 'sheet_1', title: 'Budget', sheetCount: 1 })
    expect(metadata.sheets[0]).toMatchObject({ title: 'Sheet1', rowCount: 100, columnCount: 20 })
    expect(values).toMatchObject({ spreadsheetId: 'sheet_1', range: 'Sheet1!A1:B2', rowCount: 2, columnCount: 2 })
    expect(values.values[1][1]).toBe('100')
    const [metadataUrl] = fetchImpl.mock.calls[0] as unknown as [string]
    const [valuesUrl] = fetchImpl.mock.calls[1] as unknown as [string]
    expect(metadataUrl).toContain('https://sheets.googleapis.com/v4/spreadsheets/sheet_1')
    expect(metadataUrl).toContain('ranges=Sheet1%21A1%3AB2')
    expect(valuesUrl).toContain('https://sheets.googleapis.com/v4/spreadsheets/sheet_1/values/Sheet1!A1%3AB2')
  })
})
