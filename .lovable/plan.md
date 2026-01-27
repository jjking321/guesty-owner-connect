

## Add PDF Export for Monthly Pacing Breakdown Chart

### Overview
Add a "Download PDF" button that exports the chart visualization from the Monthly Pacing Breakdown section to a PDF file. This will use `html2canvas` to capture the chart as an image and `jspdf` to generate the PDF document.

### Current State
- The PacingReport component has a chart view (lines 835-970) that renders a Recharts `LineChart` inside a `ResponsiveContainer`
- An "Export" button already exists for CSV export (lines 710-713)
- The chart is conditionally rendered when `viewMode === 'chart'`

### Implementation Plan

#### 1. Install Required Dependencies
Add `html2canvas` and `jspdf` packages:
- `html2canvas`: Captures DOM elements as canvas images
- `jspdf`: Generates PDF documents

#### 2. Update `src/components/PacingReport.tsx`

**Add Imports:**
- Import `useRef` from React
- Import `html2canvas` from html2canvas
- Import `jsPDF` from jspdf
- Import `FileText` icon from lucide-react for the PDF button

**Add Chart Ref:**
- Create a ref for the chart container: `const chartRef = useRef<HTMLDivElement>(null)`
- Wrap the chart content in a div with this ref

**Add Export PDF Function:**
Create `handleExportPacingPDF` function that:
1. Captures the chart container using `html2canvas`
2. Creates a new jsPDF document in landscape orientation
3. Calculates proper scaling to fit the chart on the page
4. Adds a title header with the current date
5. Embeds the chart image
6. Saves the PDF with filename `pacing-chart-{date}.pdf`

**Add Export PDF Button:**
- Show "Export PDF" button only when in chart view mode
- Place it next to the existing CSV Export button
- Use `FileText` icon to differentiate from CSV export

### Technical Details

**Dependencies to install:**
```bash
npm install html2canvas jspdf
npm install --save-dev @types/html2canvas
```

**Chart ref setup:**
```typescript
const chartRef = useRef<HTMLDivElement>(null);

// Wrap chart content
<div ref={chartRef} className="space-y-4 bg-white p-4">
  {/* Metric checkboxes */}
  {/* LineChart */}
</div>
```

**Export PDF function:**
```typescript
const handleExportPacingPDF = async () => {
  if (!chartRef.current) return;
  
  const canvas = await html2canvas(chartRef.current, {
    scale: 2, // Higher resolution
    backgroundColor: '#ffffff',
  });
  
  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF('landscape', 'mm', 'a4');
  
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();
  const imgWidth = canvas.width;
  const imgHeight = canvas.height;
  const ratio = Math.min(pdfWidth / imgWidth, pdfHeight / imgHeight);
  
  // Add title
  pdf.setFontSize(16);
  pdf.text('Monthly Pacing Breakdown', 14, 15);
  pdf.setFontSize(10);
  pdf.text(`Generated: ${format(new Date(), 'MMMM d, yyyy')}`, 14, 22);
  
  // Add chart image with padding for title
  const imgX = (pdfWidth - imgWidth * ratio) / 2;
  pdf.addImage(imgData, 'PNG', imgX, 30, imgWidth * ratio, imgHeight * ratio);
  
  pdf.save(`pacing-chart-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
};
```

**Button placement (conditional on chart view):**
```typescript
{isTableOpen && (
  <div className="flex items-center gap-2">
    <Button variant="outline" size="sm" onClick={handleExportPacingCSV}>
      <Download className="h-3 w-3 mr-1" />
      Export CSV
    </Button>
    {viewMode === 'chart' && (
      <Button variant="outline" size="sm" onClick={handleExportPacingPDF}>
        <FileText className="h-3 w-3 mr-1" />
        Export PDF
      </Button>
    )}
    <ToggleGroup ... />
  </div>
)}
```

### Files to Modify
| File | Changes |
|------|---------|
| `package.json` | Add html2canvas and jspdf dependencies |
| `src/components/PacingReport.tsx` | Add useRef, imports, chartRef, handleExportPacingPDF function, PDF export button |

### User Experience
1. User opens the Monthly Breakdown collapsible section
2. User switches to Chart view using the toggle
3. A new "Export PDF" button appears alongside the CSV Export button
4. Clicking Export PDF captures the current chart visualization
5. A PDF file downloads with the chart image, title, and generation date
6. The PDF uses landscape orientation for better chart readability

