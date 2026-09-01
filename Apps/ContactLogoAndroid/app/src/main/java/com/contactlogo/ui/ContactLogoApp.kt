package com.contactlogo.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import coil.compose.AsyncImage
import com.contactlogo.engine.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.net.URI

sealed class SessionError {
    data class ApplyFailed(val succeeded: Int, val failed: Int, val underlying: String) : SessionError()
    object NothingToApply : SessionError()
    data class UndoFailed(val batchId: String, val underlying: String) : SessionError()
    object NoBatchToUndo : SessionError()
}

fun sessionErrorMessage(error: SessionError): String = when (error) {
    is SessionError.ApplyFailed ->
        "${error.failed} of ${error.succeeded + error.failed} logos failed to apply (${error.underlying}).  You can try again."
    SessionError.NothingToApply -> "Nothing selected to apply."
    is SessionError.UndoFailed ->
        "Couldn't undo batch ${error.batchId.take(8)} (${error.underlying}).  You can try again."
    SessionError.NoBatchToUndo -> "There's no batch to undo."
}

class ContactLogoViewModel(
    private val repository: ContactsRepository,
    private val undoLog: UndoLog
) : ViewModel() {
    private val _results = MutableStateFlow<List<MatchResult>>(emptyList())
    val results: StateFlow<List<MatchResult>> = _results

    private val _isScanning = MutableStateFlow(false)
    val isScanning: StateFlow<Boolean> = _isScanning

    private val _isApplying = MutableStateFlow(false)
    val isApplying: StateFlow<Boolean> = _isApplying

    private val _isUndoing = MutableStateFlow(false)
    val isUndoing: StateFlow<Boolean> = _isUndoing

    private val _searchQuery = MutableStateFlow("")
    val searchQuery: StateFlow<String> = _searchQuery

    private val _statusFilter = MutableStateFlow(StatusFilter.ALL)
    val statusFilter: StateFlow<StatusFilter> = _statusFilter

    private val _undoHistory = MutableStateFlow<List<UndoLog.BatchSummary>>(emptyList())
    val undoHistory: StateFlow<List<UndoLog.BatchSummary>> = _undoHistory

    private val _lastError = MutableStateFlow<SessionError?>(null)
    val lastError: StateFlow<SessionError?> = _lastError

    init {
        refreshUndoHistory()
    }

    fun setSearchQuery(q: String) {
        _searchQuery.value = q
    }

    fun setStatusFilter(filter: StatusFilter) {
        _statusFilter.value = if (_statusFilter.value == filter) StatusFilter.ALL else filter
    }

    fun clearError() {
        _lastError.value = null
    }

    fun scanContacts() {
        viewModelScope.launch {
            _isScanning.value = true
            val contacts = repository.loadContacts()
            val matches = contacts.map { MatchPipeline.match(it) }
            _results.value = matches
            _isScanning.value = false
        }
    }

    fun toggleApproval(contactId: String) {
        _results.value = _results.value.map {
            if (it.contact.id == contactId) it.copy(approved = !it.approved) else it
        }
    }

    fun cycleCandidate(contactId: String) {
        _results.value = _results.value.map {
            if (it.contact.id == contactId) {
                val next = nextCandidateIndex(it.selectedIndex, it.candidates.size) ?: return@map it
                it.copy(selectedIndex = next)
            } else it
        }
    }

    fun selectAllHigh() {
        _results.value = _results.value.map {
            if (isReadyRow(it)) it.copy(approved = true) else it
        }
    }

    fun applyApproved() {
        viewModelScope.launch {
            _isApplying.value = true
            _lastError.value = null
            try {
                val approvedItems = _results.value.filter { it.approved && it.selectedLogo != null }
                val records = mutableListOf<UndoLog.Record>()
                val prepared = mutableListOf<Pair<String, ByteArray>>()
                for (item in approvedItems) {
                    if (MatchPipeline.isPerson(item.contact)) continue
                    val logo = item.selectedLogo ?: continue
                    val newBytes = logo.localBytes ?: repository.prepareLogo(logo.url) ?: continue
                    val previous = repository.readPhoto(item.contact.id)
                    records.add(UndoLog.Record(item.contact.id, previous))
                    prepared.add(item.contact.id to newBytes)
                }
                if (records.isEmpty()) {
                    _lastError.value = SessionError.NothingToApply
                    return@launch
                }
                try {
                    undoLog.recordBatch(records)
                } catch (e: Exception) {
                    _lastError.value = SessionError.ApplyFailed(
                        0,
                        records.size,
                        e.message ?: "undo log"
                    )
                    return@launch
                }
                var succeeded = 0
                var failed = 0
                var reason: String? = null
                for ((id, bytes) in prepared) {
                    if (repository.writePhoto(id, bytes)) {
                        succeeded += 1
                    } else {
                        failed += 1
                        if (reason == null) reason = "write failed"
                    }
                }
                if (reason != null) {
                    _lastError.value = SessionError.ApplyFailed(succeeded, failed, reason)
                }
                undoLog.prune()
                refreshUndoHistory()
                scanContacts()
            } finally {
                _isApplying.value = false
            }
        }
    }

    fun undoLastBatch() {
        val id = _undoHistory.value.firstOrNull()?.id
        if (id == null) {
            _lastError.value = SessionError.NoBatchToUndo
            return
        }
        undo(id)
    }

    /**
     * Restore [batchId] and every newer batch, newest first.  A log is deleted
     * only once its own restore has succeeded; a failure stops the unwind with
     * everything not yet restored still on disk.
     */
    fun undo(batchId: String) {
        viewModelScope.launch {
            _isUndoing.value = true
            _lastError.value = null
            try {
                val history = undoLog.listBatchSummaries()
                val index = history.indexOfFirst { it.id == batchId }
                val toUnwind = if (index >= 0) {
                    history.subList(0, index + 1)
                } else {
                    listOf(UndoLog.BatchSummary(batchId, 0.0, 0))
                }
                for (summary in toUnwind) {
                    try {
                        val ops = undoLog.loadRestoreOps(summary.id)
                        for (op in ops) {
                            val ok = if (op.previousBytes != null) {
                                repository.writePhoto(op.contactId, op.previousBytes)
                            } else {
                                repository.removePhoto(op.contactId)
                            }
                            if (!ok) {
                                throw UndoLog.UndoException("could not restore contact ${op.contactId}")
                            }
                        }
                    } catch (e: Exception) {
                        _lastError.value = SessionError.UndoFailed(
                            summary.id,
                            e.message ?: "restore failed"
                        )
                        refreshUndoHistory()
                        return@launch
                    }
                    try {
                        undoLog.deleteBatch(summary.id)
                    } catch (e: Exception) {
                        _lastError.value = SessionError.UndoFailed(
                            summary.id,
                            "restored, but its undo log could not be removed: ${e.message}"
                        )
                        refreshUndoHistory()
                        return@launch
                    }
                }
                refreshUndoHistory()
                scanContacts()
            } finally {
                _isUndoing.value = false
            }
        }
    }

    suspend fun applyManualBytes(contactId: String, bytes: ByteArray): String? {
        val prepared = repository.prepareLogoBytes(bytes) ?: return "Couldn't read that photo."
        injectManual(contactId, prepared, "manual")
        return null
    }

    suspend fun applyManualUrl(contactId: String, url: String): String? {
        val trimmed = url.trim()
        val parsed = try {
            URI(trimmed)
        } catch (_: Exception) {
            null
        }
        if (parsed == null || parsed.scheme.isNullOrBlank()) {
            return "That doesn't look like a valid URL."
        }
        val prepared = repository.prepareLogo(trimmed) ?: return "Couldn't fetch that image."
        injectManual(contactId, prepared, "url")
        return null
    }

    private fun injectManual(contactId: String, bytes: ByteArray, source: String) {
        _results.value = _results.value.map {
            if (it.contact.id != contactId) it
            else {
                val candidate = LogoCandidate(
                    url = "manual://$contactId",
                    source = source,
                    localBytes = bytes
                )
                it.copy(
                    candidates = listOf(candidate) + it.candidates,
                    selectedIndex = 0,
                    approved = true
                )
            }
        }
    }

    private fun refreshUndoHistory() {
        _undoHistory.value = undoLog.listBatchSummaries()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ContactLogoApp(viewModel: ContactLogoViewModel) {
    val results by viewModel.results.collectAsState()
    val isScanning by viewModel.isScanning.collectAsState()
    val isApplying by viewModel.isApplying.collectAsState()
    val isUndoing by viewModel.isUndoing.collectAsState()
    val searchQuery by viewModel.searchQuery.collectAsState()
    val statusFilter by viewModel.statusFilter.collectAsState()
    val undoHistory by viewModel.undoHistory.collectAsState()
    val lastError by viewModel.lastError.collectAsState()
    var overrideContactId by remember { mutableStateOf<String?>(null) }

    val busy = isScanning || isApplying || isUndoing

    val filteredResults = remember(results, searchQuery, statusFilter) {
        val q = searchQuery.lowercase()
        results.filter { result ->
            val matchesSearch = searchQuery.isBlank() ||
                result.contact.displayName.lowercase().contains(q) ||
                result.contact.organization.lowercase().contains(q) ||
                (result.matchedDomain?.lowercase()?.contains(q) == true)
            matchesSearch && matchesStatusFilter(result, statusFilter)
        }
    }

    val readyCount = results.count { isReadyRow(it) }
    val reviewCount = results.count { isReviewRow(it) }
    val skipCount = results.count { isSkippedRow(it) }
    val approvedCount = results.count { it.approved }

    val overrideResult = results.find { it.contact.id == overrideContactId }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("ContactLogo", fontWeight = FontWeight.Bold, fontSize = 20.sp)
                        Text("Brand icons for your address book", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f))
                    }
                },
                actions = {
                    Button(
                        onClick = { viewModel.scanContacts() },
                        enabled = !busy,
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
                    ) {
                        if (isScanning) {
                            CircularProgressIndicator(modifier = Modifier.size(16.dp), color = Color.White, strokeWidth = 2.dp)
                            Spacer(Modifier.width(6.dp))
                        }
                        Text("Scan")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface)
            )
        },
        bottomBar = {
            if (results.isNotEmpty()) {
                Surface(
                    color = MaterialTheme.colorScheme.surface,
                    tonalElevation = 8.dp,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp)
                    ) {
                        if (lastError != null) {
                            Text(
                                sessionErrorMessage(lastError!!),
                                color = Color(0xFFB3261E),
                                fontSize = 12.sp,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { viewModel.clearError() }
                                    .padding(bottom = 8.dp)
                            )
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            val newest = undoHistory.firstOrNull()
                            TextButton(
                                onClick = { viewModel.undoLastBatch() },
                                enabled = newest != null && !busy
                            ) {
                                Icon(Icons.AutoMirrored.Filled.Undo, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(4.dp))
                                Text(
                                    if (newest != null) "Undo last batch (${newest.contactCount})"
                                    else "Undo last batch"
                                )
                            }
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("$approvedCount selected", fontWeight = FontWeight.SemiBold)
                                Spacer(Modifier.width(8.dp))
                                Button(
                                    onClick = { viewModel.applyApproved() },
                                    enabled = approvedCount > 0 && !busy,
                                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF22C55E))
                                ) {
                                    if (isApplying) {
                                        CircularProgressIndicator(modifier = Modifier.size(16.dp), color = Color.White, strokeWidth = 2.dp)
                                        Spacer(Modifier.width(6.dp))
                                    }
                                    Text("Apply $approvedCount Logos")
                                }
                            }
                        }
                    }
                }
            }
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .padding(horizontal = 16.dp)
        ) {
            if (results.isEmpty() && !isScanning) {
                EmptyScanState(onScan = { viewModel.scanContacts() })
            } else {
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = { viewModel.setSearchQuery(it) },
                    placeholder = { Text("Search contacts, brands, or domains…") },
                    leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 8.dp),
                    shape = RoundedCornerShape(12.dp)
                )

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    MetricChip(
                        title = "Ready",
                        count = readyCount,
                        color = Color(0xFF22C55E),
                        selected = statusFilter == StatusFilter.READY,
                        modifier = Modifier.weight(1f),
                        onClick = { viewModel.setStatusFilter(StatusFilter.READY) }
                    )
                    MetricChip(
                        title = "Review",
                        count = reviewCount,
                        color = Color(0xFFF59E0B),
                        selected = statusFilter == StatusFilter.REVIEW,
                        modifier = Modifier.weight(1f),
                        onClick = { viewModel.setStatusFilter(StatusFilter.REVIEW) }
                    )
                    MetricChip(
                        title = "Skipped",
                        count = skipCount,
                        color = Color(0xFF94A3B8),
                        selected = statusFilter == StatusFilter.SKIPPED,
                        modifier = Modifier.weight(1f),
                        onClick = { viewModel.setStatusFilter(StatusFilter.SKIPPED) }
                    )
                }

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 8.dp),
                    horizontalArrangement = Arrangement.End
                ) {
                    OutlinedButton(
                        onClick = { viewModel.selectAllHigh() },
                        enabled = readyCount > 0 && !busy
                    ) {
                        Text("Select High")
                    }
                }

                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = PaddingValues(bottom = 16.dp)
                ) {
                    items(filteredResults, key = { it.contact.id }) { result ->
                        ContactRow(
                            result = result,
                            onToggleApprove = { viewModel.toggleApproval(result.contact.id) },
                            onCycleCandidate = { viewModel.cycleCandidate(result.contact.id) },
                            onManualOverride = { overrideContactId = result.contact.id }
                        )
                    }
                }
            }
        }
    }

    if (overrideResult != null) {
        ManualOverrideDialog(
            contactName = overrideResult.contact.displayName.ifBlank { overrideResult.contact.organization },
            onDismiss = { overrideContactId = null },
            onBytes = { viewModel.applyManualBytes(overrideResult.contact.id, it) },
            onUrl = { viewModel.applyManualUrl(overrideResult.contact.id, it) }
        )
    }
}

@Composable
fun EmptyScanState(onScan: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Surface(
            shape = CircleShape,
            color = MaterialTheme.colorScheme.primary.copy(alpha = 0.15f),
            modifier = Modifier.size(80.dp)
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    Icons.Default.Contacts,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(40.dp)
                )
            }
        }
        Spacer(Modifier.height(16.dp))
        Text(
            "Review-First Address Book Icons",
            fontWeight = FontWeight.Bold,
            fontSize = 18.sp
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "Scan your device contacts to find verified corporate logos and match them with zero photo overwrites without your approval.",
            fontSize = 14.sp,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
            modifier = Modifier.padding(horizontal = 16.dp)
        )
        Spacer(Modifier.height(24.dp))
        Button(
            onClick = onScan,
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.height(48.dp)
        ) {
            Icon(Icons.Default.Refresh, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text("Scan Address Book", fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
fun MetricChip(
    title: String,
    count: Int,
    color: Color,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
    onClick: (() -> Unit)? = null
) {
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = color.copy(alpha = if (selected) 0.28f else 0.12f),
        modifier = modifier
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .then(
                if (selected) Modifier.border(1.5.dp, color, RoundedCornerShape(10.dp))
                else Modifier
            )
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(title, fontSize = 12.sp, color = color, fontWeight = FontWeight.SemiBold)
            Text("$count", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = color)
        }
    }
}

@Composable
fun ContactRow(
    result: MatchResult,
    onToggleApprove: () -> Unit,
    onCycleCandidate: () -> Unit,
    onManualOverride: () -> Unit
) {
    val logo = result.selectedLogo
    Card(
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(52.dp)
                    .clip(CircleShape)
                    .background(Color(0xFF1E293B))
                    .border(1.dp, Color(0xFF334155), CircleShape),
                contentAlignment = Alignment.Center
            ) {
                if (logo != null) {
                    AsyncImage(
                        model = logo.localBytes ?: logo.url,
                        contentDescription = result.contact.displayName,
                        contentScale = ContentScale.Fit,
                        modifier = Modifier
                            .size(36.dp)
                            .clip(CircleShape)
                    )
                } else {
                    Text(
                        result.contact.displayName.take(1).uppercase(),
                        fontWeight = FontWeight.Bold,
                        color = Color.White
                    )
                }
            }

            Spacer(Modifier.width(12.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = result.contact.displayName.ifBlank { result.contact.organization },
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 15.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                if (result.matchedDomain != null) {
                    Text(
                        text = result.matchedDomain,
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.primary
                    )
                } else {
                    Text(
                        text = "No matching brand",
                        fontSize = 12.sp,
                        color = Color.Gray
                    )
                }

                if (result.candidates.size > 1) {
                    val next = nextCandidateIndex(result.selectedIndex, result.candidates.size)
                    Row(
                        modifier = Modifier
                            .padding(top = 4.dp)
                            .clickable(enabled = next != null, onClick = onCycleCandidate),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.Default.Refresh,
                            contentDescription = null,
                            modifier = Modifier.size(12.dp),
                            tint = Color(0xFF38BDF8)
                        )
                        Spacer(Modifier.width(4.dp))
                        Text(
                            if (next != null) {
                                "Candidate ${result.selectedIndex + 1} of ${result.candidates.size} (${result.selectedLogo?.source})"
                            } else {
                                "Last candidate of ${result.candidates.size} (${result.selectedLogo?.source})"
                            },
                            fontSize = 11.sp,
                            color = Color(0xFF38BDF8)
                        )
                    }
                }

                Row(
                    modifier = Modifier
                        .padding(top = 4.dp)
                        .clickable(onClick = onManualOverride),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        Icons.Default.AddPhotoAlternate,
                        contentDescription = "Choose your own image",
                        modifier = Modifier.size(12.dp),
                        tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                    )
                    Spacer(Modifier.width(4.dp))
                    Text(
                        "Choose your own…",
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                    )
                }
            }

            if (result.candidates.isNotEmpty()) {
                Checkbox(
                    checked = result.approved,
                    onCheckedChange = { onToggleApprove() },
                    colors = CheckboxDefaults.colors(checkedColor = Color(0xFF22C55E))
                )
            }
        }
    }
}
