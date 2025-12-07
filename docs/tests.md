# Test Plan - Stepmania99

## Testing Philosophy

Precision is everything. Tests must verify:
1. **Timing accuracy**: Audio, visuals, and input are synchronized
2. **Judgment correctness**: Timing windows are exact
3. **Score calculations**: Math is correct under all conditions
4. **Parser robustness**: Step files are parsed correctly or rejected clearly

## Test Categories

1. [Unit Tests](#unit-tests) - Core logic in isolation
2. [Integration Tests](#integration-tests) - Systems working together
3. [End-to-End Tests](#end-to-end-tests) - Full gameplay scenarios
4. [Performance Tests](#performance-tests) - Speed and consistency
5. [Visual Tests](#visual-tests) - Rendering accuracy

---

## Unit Tests

### Step File Parser

#### Header Parsing

```gherkin
Scenario: Parse required headers
  Given a step file with content:
    """
    #TITLE:Test Song
    #BPM:120
    #MUSIC:song.mp3
    """
  When the parser processes the file
  Then song.title should equal "Test Song"
  And song.bpm should equal 120
  And song.musicFile should equal "song.mp3"

Scenario: Parse optional headers
  Given a step file with:
    """
    #TITLE:Test
    #BPM:140
    #MUSIC:s.mp3
    #ARTIST:Test Artist
    #OFFSET:0.150
    """
  When parsed
  Then song.artist should equal "Test Artist"
  And song.offset should equal 150 (ms)

Scenario: Reject missing required header
  Given a step file missing #BPM
  When parsed
  Then should throw error "Missing required header: BPM"

Scenario: Reject invalid BPM
  Given step file with #BPM:-50
  When parsed
  Then should throw error "BPM must be positive"

Scenario: Reject invalid BPM (zero)
  Given step file with #BPM:0
  When parsed
  Then should throw error "BPM must be positive"
```

#### Note Parsing

```gherkin
Scenario: Parse quarter notes (4 rows per measure)
  Given measure with 4 rows:
    """
    L...
    ....
    ...R
    ....
    """
  And BPM is 120
  When parsed
  Then should produce 2 notes
  And note[0] should be {time: 0, direction: 'left'}
  And note[1] should be {time: 1000, direction: 'right'}

Scenario: Parse eighth notes (8 rows per measure)
  Given measure with 8 rows at BPM 120
  When row 0 has "L..."
  And row 4 has "...R"
  Then note[0].time should be 0ms
  And note[1].time should be 1000ms

Scenario: Parse sixteenth notes (16 rows per measure)
  Given measure with 16 rows at BPM 120
  When row 0 has "L..."
  And row 1 has "...R"
  Then time difference should be 125ms (500ms / 4)

Scenario: Parse jump (multiple arrows same row)
  Given row "L..R"
  When parsed
  Then should produce 2 notes with same timestamp
  And notes should be left and right

Scenario: Parse all four arrows (quad)
  Given row "LDUR"
  When parsed
  Then should produce 4 notes with same timestamp

Scenario: Reject invalid row length
  Given row "L.."
  When parsed
  Then should throw "Invalid row: must be exactly 4 characters"

Scenario: Reject invalid characters
  Given row "LXUR"
  When parsed
  Then should throw "Invalid character 'X' in row"

Scenario: Handle empty measure
  Given measure with 4 empty rows
  When parsed
  Then should produce 0 notes
  And should not throw

Scenario: Multi-measure timing
  Given 2 measures, each 4 rows, BPM 120
  When measure 1 row 0 has "L..."
  And measure 2 row 0 has "...R"
  Then note[0].time should be 0ms
  And note[1].time should be 2000ms (one full measure later)
```

#### Chart Parsing

```gherkin
Scenario: Parse difficulty declaration
  Given line "//--- CHART: Hard (Level 12) ---"
  When parsed
  Then difficulty should be "Hard"
  And level should be 12

Scenario: Parse multiple charts
  Given file with Easy and Hard charts
  When parsed
  Then song.charts.length should be 2
  And charts should have correct difficulties

Scenario: Reject invalid difficulty
  Given line "//--- CHART: Extreme (Level 5) ---"
  When parsed
  Then should throw "Invalid difficulty: Extreme"
```

---

### Timing Engine

#### Beat Calculations

```gherkin
Scenario: Calculate time from beat at 120 BPM
  Given BPM is 120
  When beat is 0
  Then time should be 0ms
  When beat is 1
  Then time should be 500ms
  When beat is 4
  Then time should be 2000ms

Scenario: Calculate time with offset
  Given BPM 120, offset 100ms
  When beat is 0
  Then time should be 100ms
  When beat is 1
  Then time should be 600ms

Scenario: Calculate beat from time
  Given BPM 120
  When time is 500ms
  Then beat should be 1
  When time is 750ms
  Then beat should be 1.5
```

#### Judgment Calculations

```gherkin
Scenario: Marvelous judgment
  Given note at 1000ms
  When input at 1000ms (0ms diff)
  Then judgment should be "marvelous"

  When input at 1022ms (+22ms)
  Then judgment should be "marvelous"

  When input at 978ms (-22ms)
  Then judgment should be "marvelous"

Scenario: Perfect judgment boundary
  Given note at 1000ms
  When input at 1023ms (+23ms)
  Then judgment should be "perfect" (not marvelous)

  When input at 1045ms (+45ms)
  Then judgment should be "perfect"

Scenario: Great judgment boundary
  Given note at 1000ms
  When input at 1046ms
  Then judgment should be "great" (not perfect)

  When input at 1090ms
  Then judgment should be "great"

Scenario: Good judgment boundary
  Given note at 1000ms
  When input at 1091ms
  Then judgment should be "good" (not great)

  When input at 1135ms
  Then judgment should be "good"

Scenario: Boo judgment boundary
  Given note at 1000ms
  When input at 1136ms
  Then judgment should be "boo" (not good)

  When input at 1180ms
  Then judgment should be "boo"

Scenario: Miss
  Given note at 1000ms
  When input at 1181ms
  Then judgment should be "miss"

Scenario: Early inputs
  Given note at 1000ms
  When input at 800ms (-200ms)
  Then should not match (too early, wait for note)

Scenario: Symmetric windows
  Given note at 1000ms
  Then judgment at 1045ms should equal judgment at 955ms
  And judgment at 1090ms should equal judgment at 910ms
```

#### Jump Judgment

```gherkin
Scenario: Perfect jump
  Given jump with left+right at 1000ms
  When left pressed at 1000ms
  And right pressed at 1005ms
  Then both should judge as "marvelous"

Scenario: Split jump timing
  Given jump with left+right at 1000ms
  When left pressed at 1000ms (marvelous)
  And right pressed at 1050ms (great)
  Then left should be "marvelous"
  And right should be "great"
  And combo should increase by 2

Scenario: Partial jump miss
  Given jump with left+right at 1000ms
  When left pressed at 1000ms
  And right never pressed
  Then left should be "marvelous"
  And right should be "miss"
  And combo should break
```

---

### Scoring System

```gherkin
Scenario: Single note scoring
  Given max score is 1,000,000
  And song has 100 notes
  When all notes are marvelous
  Then score should be 1,000,000

Scenario: Mixed judgment scoring
  Given song with 4 notes
  When judgments are [marvelous, perfect, great, good]
  Then score should be proportional to (100 + 98 + 65 + 25) / 400

Scenario: Combo multiplier
  Given current combo is 10
  When next note is hit
  Then combo multiplier should be 2x

  Given combo is 20
  Then multiplier should be 3x

  Given combo is 30+
  Then multiplier should be 4x (max)

Scenario: Combo break
  Given combo is 50
  When miss occurs
  Then combo should reset to 0
  And multiplier should reset to 1x

Scenario: Boo breaks combo
  Given combo is 25
  When boo judgment
  Then combo should reset to 0
```

### Grade Calculation

```gherkin
Scenario: Grade thresholds
  Given final percentage
  When percentage is 100%
  Then grade should be "AAA"

  When percentage is 93%
  Then grade should be "AA"

  When percentage is 92.9%
  Then grade should be "A"

  When percentage is 80%
  Then grade should be "A"

  When percentage is 79.9%
  Then grade should be "B"

  When percentage is 65%
  Then grade should be "B"

  When percentage is 45%
  Then grade should be "C"

  When percentage is 44%
  Then grade should be "D"
```

---

## Integration Tests

### Audio-Visual Sync

```gherkin
Scenario: Notes appear at correct time
  Given song with note at beat 4 (2000ms at 120 BPM)
  And scroll speed shows 2 seconds of notes
  When audio time is 0ms
  Then note should be visible at top of screen

  When audio time is 1000ms
  Then note should be at 50% scroll position

  When audio time is 2000ms
  Then note should be at receptor position

Scenario: Audio offset compensation
  Given global audio offset of +50ms
  And note at 1000ms
  When audio reports 1000ms
  Then game should treat it as 950ms for visuals
  And note should hit receptor at audio 1050ms
```

### Input Processing

```gherkin
Scenario: Input timestamps are accurate
  Given note at 1000ms
  When key pressed
  Then input timestamp should use performance.now()
  And timestamp should be within 1ms of actual press

Scenario: Rapid input handling
  Given 4 notes at 100ms intervals
  When all 4 keys pressed within 400ms
  Then all 4 should register with correct timestamps
  And no inputs should be dropped

Scenario: Input during frame drop
  Given frame takes 50ms (dropped frame)
  When key pressed during that frame
  Then input timestamp should still be accurate
  And not delayed to next frame
```

### Song Loading

```gherkin
Scenario: Load song from directory
  Given songs/test-song/ contains:
    - song.mp3
    - chart.stp
  When song is loaded
  Then audio should be playable
  And chart should be parsed
  And song should appear in song list

Scenario: Handle missing audio file
  Given chart.stp references "song.mp3"
  But song.mp3 does not exist
  When loaded
  Then should show error "Audio file not found: song.mp3"

Scenario: Handle corrupt step file
  Given chart.stp has syntax errors
  When loaded
  Then should show error with line number
  And song should not appear in list
```

---

## End-to-End Tests

### Complete Gameplay Flow

```gherkin
Scenario: Full song playthrough
  Given song "Test Song" is loaded
  When player starts song
  Then audio should play
  And notes should scroll
  When player hits all notes perfectly
  Then score should be 1,000,000
  And grade should be AAA
  And results screen should show stats

Scenario: Pause and resume
  Given gameplay is active
  When Escape pressed
  Then audio should pause
  And game should pause
  And pause overlay should appear
  When Enter pressed
  Then countdown should appear (3, 2, 1)
  And gameplay should resume
  And audio should resume

Scenario: Tab visibility change
  Given gameplay is active
  When browser tab becomes hidden
  Then game should auto-pause
  When tab becomes visible
  Then pause menu should be shown

Scenario: Song select to gameplay to results
  Given on song select screen
  When song is selected and confirmed
  Then gameplay should start
  When song ends
  Then results should show
  When confirmed
  Then should return to song select
```

### Edge Cases

```gherkin
Scenario: Very fast BPM (300+)
  Given song at 300 BPM with 16th notes
  When played
  Then all notes should render correctly
  And timing should remain accurate
  And no frame drops should occur

Scenario: Very slow BPM (60)
  Given song at 60 BPM
  When played
  Then notes should scroll smoothly
  And timing windows should work correctly

Scenario: First note immediately
  Given song with note at 0ms
  When song starts
  Then note should already be at receptor
  And player can still hit it within window

Scenario: Last note at song end
  Given song with note at final beat
  When audio ends
  Then note should still be judgeable
  And miss should register if not hit
```

---

## Performance Tests

### Frame Rate

```gherkin
Scenario: Maintain 60fps
  Given gameplay with 50 notes on screen
  When measured over 10 seconds
  Then average frame time should be < 16.67ms
  And 99th percentile should be < 20ms
  And no frame should exceed 33ms

Scenario: No garbage collection pauses
  Given gameplay over 3 minutes
  When monitoring GC
  Then no GC pause should exceed 5ms
  And total GC time should be < 100ms
```

### Input Latency

```gherkin
Scenario: Input-to-visual response
  Given gameplay is active
  When key is pressed
  Then receptor flash should appear within 1 frame (16ms)

Scenario: Input-to-judgment response
  Given note at current time
  When key pressed
  Then judgment should be calculated same frame
  And judgment display should appear within 1 frame
```

### Memory

```gherkin
Scenario: No memory leaks during gameplay
  Given song plays repeatedly 10 times
  When measuring heap
  Then memory should not grow unbounded
  And should return to baseline between songs
```

---

## Visual Tests (Snapshot/Screenshot)

```gherkin
Scenario: Arrow rendering
  Given left arrow note
  When rendered
  Then should match reference image for left arrow

Scenario: Receptor states
  Given receptor in idle state
  Then should match idle reference

  Given receptor when key pressed
  Then should match pressed/lit reference

Scenario: Judgment display
  Given marvelous judgment
  When displayed
  Then should show "MARVELOUS" with correct styling

Scenario: Combo display
  Given combo of 100
  When displayed
  Then should show "100 COMBO" with correct styling
```

---

## Test Data Requirements

### Test Songs

1. **timing-test.stp**: Single notes at exact beat intervals for timing verification
2. **judgment-test.stp**: Notes at various timings to test all judgment windows
3. **stress-test.stp**: Maximum note density for performance testing
4. **edge-cases.stp**: First beat notes, last beat notes, 300 BPM sections

### Mock Audio

- Silent MP3 files with exact durations for deterministic testing
- 1-second, 10-second, 60-second variants

---

## CI/CD Integration

```yaml
# Test stages
stages:
  - unit        # Fast, no browser needed
  - integration # May need browser APIs
  - e2e         # Full browser automation
  - performance # Isolated environment, measure metrics

# Coverage requirements
coverage:
  branches: 90%
  functions: 95%
  lines: 90%

# Performance budgets
budgets:
  frame_time_p99: 20ms
  input_latency: 16ms
  bundle_size: 100kb
```
