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

class ContactLogoViewModel(private val repository: ContactsRepository) : ViewModel() {
    private val _results = MutableStateFlow<List<MatchResult>>(emptyList())
    val results: StateFlow<List<MatchResult>> = _results

    private val _isScanning = MutableStateFlow(false)
    val isScanning: StateFlow<Boolean> = _isScanning

    private val _isApplying = MutableStateFlow(false)
    val isApplying: StateFlow<Boolean> = _isApplying

    private val _searchQuery = MutableStateFlow("")
    val searchQuery: StateFlow<String> = _searchQuery

    fun setSearchQuery(q: String) {
        _searchQuery.value = q
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
            if (it.contact.id == contactId && it.candidates.isNotEmpty()) {
                val nextIdx = (it.selectedIndex + 1) % it.candidates.size
                it.copy(selectedIndex = nextIdx)
            } else it
        }
    }

    fun selectAllHigh() {
        _results.value = _results.value.map {
            if (it.confidence == Confidence.HIGH && it.candidates.isNotEmpty()) it.copy(approved = true) else it
        }
    }

    fun applyApproved() {
        viewModelScope.launch {
            _isApplying.value = true
            val approvedItems = _results.value.filter { it.approved && it.selectedLogo != null }
            for (item in approvedItems) {
                if (MatchPipeline.isPerson(item.contact)) continue
                val logo = item.selectedLogo ?: continue
                repository.applyPhoto(item.contact.id, logo.url)
            }
            _isApplying.value = false
            scanContacts()
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ContactLogoApp(viewModel: ContactLogoViewModel) {
    val results by viewModel.results.collectAsState()
    val isScanning by viewModel.isScanning.collectAsState()
    val isApplying by viewModel.isApplying.collectAsState()
    val searchQuery by viewModel.searchQuery.collectAsState()

    val filteredResults = remember(results, searchQuery) {
        if (searchQuery.isBlank()) results
        else {
            val q = searchQuery.lowercase()
            results.filter {
                it.contact.displayName.lowercase().contains(q) ||
                it.contact.organization.lowercase().contains(q) ||
                (it.matchedDomain?.lowercase()?.contains(q) == true)
            }
        }
    }

    val readyCount = results.count { it.confidence == Confidence.HIGH && it.candidates.isNotEmpty() }
    val reviewCount = results.count { it.confidence == Confidence.MEDIUM && it.candidates.isNotEmpty() }
    val skipCount = results.count { it.confidence == Confidence.SKIP || it.candidates.isEmpty() }
    val approvedCount = results.count { it.approved }

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
                        enabled = !isScanning && !isApplying,
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
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("$approvedCount selected", fontWeight = FontWeight.SemiBold)
                        Button(
                            onClick = { viewModel.applyApproved() },
                            enabled = approvedCount > 0 && !isApplying,
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

                // Status Metric Cards
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
                        modifier = Modifier.weight(1f),
                        onClick = { viewModel.selectAllHigh() }
                    )
                    MetricChip(
                        title = "Review",
                        count = reviewCount,
                        color = Color(0xFFF59E0B),
                        modifier = Modifier.weight(1f)
                    )
                    MetricChip(
                        title = "Skipped",
                        count = skipCount,
                        color = Color(0xFF94A3B8),
                        modifier = Modifier.weight(1f)
                    )
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
                            onCycleCandidate = { viewModel.cycleCandidate(result.contact.id) }
                        )
                    }
                }
            }
        }
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
fun MetricChip(title: String, count: Int, color: Color, modifier: Modifier = Modifier, onClick: (() -> Unit)? = null) {
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = color.copy(alpha = 0.12f),
        modifier = modifier
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
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
    onCycleCandidate: () -> Unit
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
            // Circular Avatar Preview
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
                        model = logo.url,
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
                    Row(
                        modifier = Modifier
                            .padding(top = 4.dp)
                            .clickable(onClick = onCycleCandidate),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(12.dp), tint = Color(0xFF38BDF8))
                        Spacer(Modifier.width(4.dp))
                        Text(
                            "Candidate ${result.selectedIndex + 1} of ${result.candidates.size} (${result.selectedLogo?.source})",
                            fontSize = 11.sp,
                            color = Color(0xFF38BDF8)
                        )
                    }
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
