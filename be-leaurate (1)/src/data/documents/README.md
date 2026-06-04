# PDF Preview Input Folder

Place application PDFs in this folder.

Rules:
- Filename must match the value in the `attachments` field from seeded data.
- Example: if attachments is `CAS.pdf`, place `CAS.pdf` here.
- These files are served by backend route: `/documents/<filename>`.
