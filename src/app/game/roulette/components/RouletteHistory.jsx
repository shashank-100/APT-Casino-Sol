"use client";
import React, { useState } from 'react';
import { Box, Typography, Paper, Tabs, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Chip, CircularProgress, Fade } from '@mui/material';
import { FaHistory, FaChartLine, FaFire, FaExclamationCircle, FaCoins, FaInfoCircle, FaTrophy, FaDice } from 'react-icons/fa';

// Sample data for demonstration - would be fetched from API in real app
const sampleBets = [
  { id: 1, time: '2023-06-22T14:35:22Z', type: 'Red', amount: 10, result: 23, win: true, payout: 20 },
  { id: 2, time: '2023-06-22T14:32:19Z', type: 'Even', amount: 15, result: 16, win: true, payout: 30 },
  { id: 3, time: '2023-06-22T14:30:05Z', type: 'Black', amount: 20, result: 15, win: false, payout: 0 },
  { id: 4, time: '2023-06-22T14:25:45Z', type: 'Straight Up (17)', amount: 5, result: 17, win: true, payout: 175 },
  { id: 5, time: '2023-06-22T14:22:10Z', type: 'Split (4/7)', amount: 10, result: 22, win: false, payout: 0 },
  { id: 6, time: '2023-06-22T14:18:33Z', type: 'Corner (22-25)', amount: 15, result: 22, win: true, payout: 120 },
  { id: 7, time: '2023-06-22T14:15:21Z', type: 'Dozen (1-12)', amount: 25, result: 5, win: true, payout: 75 },
  { id: 8, time: '2023-06-22T14:12:08Z', type: 'High (19-36)', amount: 20, result: 12, win: false, payout: 0 },
  { id: 9, time: '2023-06-22T14:08:55Z', type: 'Column (2nd)', amount: 10, result: 8, win: false, payout: 0 },
  { id: 10, time: '2023-06-22T14:05:42Z', type: 'Odd', amount: 15, result: 33, win: false, payout: 0 },
];

// Function to calculate statistics from bet history
const calculateStats = (bets) => {
  const totalBets = bets.length;
  const totalWagered = bets.reduce((sum, bet) => sum + bet.amount, 0);
  const totalWon = bets.reduce((sum, bet) => sum + bet.payout, 0);
  const winCount = bets.filter(bet => bet.win).length;
  const winRate = totalBets > 0 ? (winCount / totalBets) * 100 : 0;
  const netProfit = totalWon - totalWagered;
  const roi = totalWagered > 0 ? (netProfit / totalWagered) * 100 : 0;
  
  // Get most common results
  const resultCounts = {};
  bets.forEach(bet => {
    resultCounts[bet.result] = (resultCounts[bet.result] || 0) + 1;
  });
  
  const mostCommonResults = Object.entries(resultCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([number, count]) => ({
      number: parseInt(number),
      count: count
    }));
    
  // Find biggest win
  const biggestWin = bets.reduce((max, bet) => bet.payout > max.payout ? bet : max, { payout: 0 });
  
  return {
    totalBets,
    totalWagered,
    totalWon,
    winRate,
    netProfit,
    roi,
    mostCommonResults,
    biggestWin: biggestWin.payout > 0 ? biggestWin : null
  };
};

const RouletteHistory = () => {
  const [tabValue, setTabValue] = useState(0);
  const [loading, setLoading] = useState(false);
  const [bets, setBets] = useState(sampleBets);
  
  const stats = calculateStats(bets);
  
  const handleTabChange = (event, newValue) => {
    setTabValue(newValue);
  };
  
  const formatTime = (timeString) => {
    const date = new Date(timeString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  
  const formatDate = (timeString) => {
    const date = new Date(timeString);
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };
  
  // Determine color based on roulette number
  const getNumberColor = (num) => {
    if (num === 0) return '#14D854'; // Green for zero
    const redNumbers = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
    return redNumbers.includes(num) ? '#d82633' : '#333'; // Red or black
  };
  
  return (
    <Paper
      elevation={5}
      sx={{
        p: { xs: 2, md: 3 },
        borderRadius: 3,
        background: 'linear-gradient(135deg, rgba(9, 0, 5, 0.9) 0%, rgba(25, 5, 30, 0.85) 100%)',
        backdropFilter: 'blur(15px)',
        border: '1px solid rgba(104, 29, 219, 0.2)',
        mb: 5,
        position: 'relative',
        overflow: 'hidden',
        boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '5px',
          background: 'linear-gradient(90deg, #14D854, #d82633)',
        }
      }}
    >
      <Typography 
        variant="h5" 
        fontWeight="bold" 
        gutterBottom
        sx={{ 
          borderBottom: '1px solid rgba(104, 29, 219, 0.3)',
          pb: 1.5,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          color: 'white',
          textShadow: '0 2px 4px rgba(0,0,0,0.5)'
        }}
      >
        <FaHistory color="#681DDB" size={22} />
        <span style={{ background: 'linear-gradient(90deg, #FFFFFF, #FFA500)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Your Roulette History
        </span>
      </Typography>
      
      <Tabs 
        value={tabValue} 
        onChange={handleTabChange}
        sx={{ 
          mb: 3,
          '& .MuiTabs-indicator': {
            backgroundColor: '#681DDB',
            height: '3px',
            borderRadius: '3px'
          }
        }}
      >
        <Tab 
          label="Recent Bets" 
          icon={<FaDice size={16} />}
          iconPosition="start"
          sx={{ 
            color: tabValue === 0 ? 'white' : 'rgba(255,255,255,0.6)',
            textTransform: 'none',
            fontWeight: tabValue === 0 ? 'bold' : 'normal',
            '&.Mui-selected': {
              color: 'white',
            }
          }}
        />
        <Tab 
          label="Statistics" 
          icon={<FaChartLine size={16} />}
          iconPosition="start"
          sx={{ 
            color: tabValue === 1 ? 'white' : 'rgba(255,255,255,0.6)',
            textTransform: 'none',
            fontWeight: tabValue === 1 ? 'bold' : 'normal',
            '&.Mui-selected': {
              color: 'white',
            }
          }}
        />
      </Tabs>
      
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '200px' }}>
          <CircularProgress size={40} sx={{ color: '#681DDB' }} />
        </Box>
      ) : (
        <>
          {tabValue === 0 && (
            <Fade in={true}>
              <TableContainer sx={{ maxHeight: 400, borderRadius: 2, overflow: 'hidden', border: '1px solid rgba(104, 29, 219, 0.2)' }}>
                <Table stickyHeader>
                  <TableHead>
                    <TableRow sx={{ 
                      '& th': { 
                        background: 'linear-gradient(90deg, rgba(104, 29, 219, 0.3), rgba(104, 29, 219, 0.2))',
                        color: 'white',
                        fontWeight: 'bold',
                        fontSize: '0.85rem',
                        borderBottom: 'none',
                      } 
                    }}>
                      <TableCell>Time</TableCell>
                      <TableCell>Bet Type</TableCell>
                      <TableCell align="center">Amount</TableCell>
                      <TableCell align="center">Result</TableCell>
                      <TableCell align="right">Payout</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {bets.map((bet) => (
                      <TableRow 
                        key={bet.id}
                        sx={{ 
                          '&:hover': { backgroundColor: 'rgba(104, 29, 219, 0.1)' },
                          '& td': { 
                            color: 'rgba(255,255,255,0.8)', 
                            borderColor: 'rgba(104, 29, 219, 0.1)',
                            transition: 'all 0.2s ease'
                          },
                          transition: 'all 0.2s ease',
                        }}
                      >
                        <TableCell>
                          <Box>
                            <Typography variant="body2" fontWeight="medium">{formatTime(bet.time)}</Typography>
                            <Typography variant="caption" color="rgba(255,255,255,0.5)">{formatDate(bet.time)}</Typography>
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Chip 
                            label={bet.type} 
                            size="small"
                            sx={{ 
                              fontSize: '0.75rem',
                              bgcolor: 'rgba(104, 29, 219, 0.1)',
                              color: 'white',
                              border: '1px solid rgba(104, 29, 219, 0.2)'
                            }}
                          />
                        </TableCell>
                        <TableCell align="center">{bet.amount} APTC</TableCell>
                        <TableCell align="center">
                          <Box 
                            sx={{ 
                              width: 28, 
                              height: 28, 
                              borderRadius: '50%', 
                              backgroundColor: getNumberColor(bet.result),
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              margin: '0 auto',
                              border: '1px solid rgba(255,255,255,0.2)',
                              boxShadow: '0 3px 6px rgba(0,0,0,0.2)',
                            }}
                          >
                            <Typography variant="body2" fontWeight="bold" color="white">{bet.result}</Typography>
                          </Box>
                        </TableCell>
                        <TableCell align="right">
                          <Typography 
                            variant="body2" 
                            fontWeight="bold"
                            sx={{
                              color: bet.win ? '#14D854' : 'rgba(255,255,255,0.6)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'flex-end',
                              gap: 0.5
                            }}
                          >
                            {bet.win ? (
                              <>
                                <FaCoins size={12} color="#14D854" />
                                +{bet.payout} APTC
                              </>
                            ) : '-'}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Fade>
          )}
          
          {tabValue === 1 && (
            <Fade in={true}>
              <Box>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 4 }}>
                  <Box 
                    sx={{ 
                      flex: 1, 
                      minWidth: '150px', 
                      p: 2, 
                      borderRadius: 2, 
                      background: 'linear-gradient(135deg, rgba(0,0,0,0.3) 0%, rgba(104, 29, 219, 0.1) 100%)',
                      border: '1px solid rgba(104, 29, 219, 0.2)',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                      transition: 'all 0.3s ease',
                      '&:hover': {
                        transform: 'translateY(-3px)',
                        boxShadow: '0 6px 15px rgba(0,0,0,0.2)',
                      }
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                      <Box 
                        sx={{ 
                          width: 36, 
                          height: 36, 
                          borderRadius: '50%', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center',
                          backgroundColor: 'rgba(104, 29, 219, 0.2)',
                          boxShadow: '0 3px 6px rgba(0,0,0,0.2)',
                        }}
                      >
                        <FaChartLine color="#681DDB" size={16} />
                      </Box>
                      <Typography variant="body2" color="rgba(255,255,255,0.7)">Total Bets</Typography>
                    </Box>
                    <Typography variant="h4" fontWeight="bold" color="white" sx={{ textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>{stats.totalBets}</Typography>
                  </Box>
                  
                  <Box 
                    sx={{ 
                      flex: 1, 
                      minWidth: '150px', 
                      p: 2, 
                      borderRadius: 2, 
                      background: 'linear-gradient(135deg, rgba(0,0,0,0.3) 0%, rgba(255, 165, 0, 0.1) 100%)',
                      border: '1px solid rgba(255, 165, 0, 0.2)',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                      transition: 'all 0.3s ease',
                      '&:hover': {
                        transform: 'translateY(-3px)',
                        boxShadow: '0 6px 15px rgba(0,0,0,0.2)',
                      }
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                      <Box 
                        sx={{ 
                          width: 36, 
                          height: 36, 
                          borderRadius: '50%', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center',
                          backgroundColor: 'rgba(255, 165, 0, 0.2)',
                          boxShadow: '0 3px 6px rgba(0,0,0,0.2)',
                        }}
                      >
                        <FaFire color="#FFA500" size={16} />
                      </Box>
                      <Typography variant="body2" color="rgba(255,255,255,0.7)">Win Rate</Typography>
                    </Box>
                    <Typography variant="h4" fontWeight="bold" color="white" sx={{ textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>{stats.winRate.toFixed(1)}%</Typography>
                  </Box>
                  
                  <Box 
                    sx={{ 
                      flex: 1, 
                      minWidth: '150px', 
                      p: 2, 
                      borderRadius: 2, 
                      background: 'linear-gradient(135deg, rgba(0,0,0,0.3) 0%, rgba(216, 38, 51, 0.1) 100%)',
                      border: '1px solid rgba(216, 38, 51, 0.2)',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                      transition: 'all 0.3s ease',
                      '&:hover': {
                        transform: 'translateY(-3px)',
                        boxShadow: '0 6px 15px rgba(0,0,0,0.2)',
                      }
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                      <Box 
                        sx={{ 
                          width: 36, 
                          height: 36, 
                          borderRadius: '50%', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center',
                          backgroundColor: 'rgba(216, 38, 51, 0.2)',
                          boxShadow: '0 3px 6px rgba(0,0,0,0.2)',
                        }}
                      >
                        <FaCoins color="#d82633" size={16} />
                      </Box>
                      <Typography variant="body2" color="rgba(255,255,255,0.7)">Total Wagered</Typography>
                    </Box>
                    <Typography variant="h4" fontWeight="bold" color="white" sx={{ textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>{stats.totalWagered} APTC</Typography>
                  </Box>
                  
                  <Box 
                    sx={{ 
                      flex: 1, 
                      minWidth: '150px', 
                      p: 2, 
                      borderRadius: 2, 
                      background: 'linear-gradient(135deg, rgba(0,0,0,0.3) 0%, rgba(20, 216, 84, 0.1) 100%)',
                      border: '1px solid rgba(20, 216, 84, 0.2)',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                      transition: 'all 0.3s ease',
                      '&:hover': {
                        transform: 'translateY(-3px)',
                        boxShadow: '0 6px 15px rgba(0,0,0,0.2)',
                      }
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                      <Box 
                        sx={{ 
                          width: 36, 
                          height: 36, 
                          borderRadius: '50%', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center',
                          backgroundColor: 'rgba(20, 216, 84, 0.2)',
                          boxShadow: '0 3px 6px rgba(0,0,0,0.2)',
                        }}
                      >
                        <FaCoins color="#14D854" size={16} />
                      </Box>
                      <Typography variant="body2" color="rgba(255,255,255,0.7)">Net Profit</Typography>
                    </Box>
                    <Typography 
                      variant="h4" 
                      fontWeight="bold" 
                      color={stats.netProfit >= 0 ? '#14D854' : '#d82633'}
                      sx={{ textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}
                    >
                      {stats.netProfit >= 0 ? '+' : ''}{stats.netProfit} APTC
                    </Typography>
                  </Box>
                </Box>
                
                <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 3 }}>
                  <Box 
                    sx={{ 
                      flex: 1,
                      p: 3, 
                      borderRadius: 2, 
                      backgroundColor: 'rgba(0,0,0,0.2)',
                      border: '1px solid rgba(104, 29, 219, 0.15)',
                      position: 'relative',
                      overflow: 'hidden',
                      boxShadow: '0 4px 15px rgba(0,0,0,0.1)',
                      '&::before': {
                        content: '""',
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '4px',
                        height: '100%',
                        backgroundColor: '#FFA500',
                      }
                    }}
                  >
                    <Typography variant="subtitle1" fontWeight="bold" color="white" sx={{ mb: 2 }}>Hot Numbers</Typography>
                    
                    {stats.mostCommonResults.length > 0 ? (
                      <Box sx={{ display: 'flex', gap: 3 }}>
                        {stats.mostCommonResults.map((result, index) => (
                          <Box key={index} sx={{ textAlign: 'center' }}>
                            <Box 
                              sx={{ 
                                width: 48, 
                                height: 48, 
                                borderRadius: '50%', 
                                backgroundColor: getNumberColor(result.number),
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                margin: '0 auto 12px',
                                border: '2px solid rgba(255,255,255,0.2)',
                                boxShadow: '0 5px 15px rgba(0,0,0,0.2)',
                                position: 'relative',
                                '&::after': {
                                  content: '""',
                                  position: 'absolute',
                                  top: '-8px',
                                  right: '-8px',
                                  width: '22px',
                                  height: '22px',
                                  borderRadius: '50%',
                                  backgroundColor: '#FFA500',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  color: 'white',
                                  fontSize: '12px',
                                  fontWeight: 'bold',
                                  boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
                                  border: '1px solid rgba(255,255,255,0.2)',
                                }
                              }}
                              data-count={result.count}
                            >
                              <Typography variant="h5" fontWeight="bold" color="white" sx={{ textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>{result.number}</Typography>
                            </Box>
                            <Typography variant="body2" color="rgba(255,255,255,0.7)" sx={{ fontWeight: 'medium' }}>
                              {result.count} time{result.count !== 1 ? 's' : ''}
                            </Typography>
                          </Box>
                        ))}
                      </Box>
                    ) : (
                      <Typography variant="body2" color="rgba(255,255,255,0.5)" sx={{ fontStyle: 'italic' }}>
                        Not enough data
                      </Typography>
                    )}
                  </Box>
                  
                  <Box 
                    sx={{ 
                      flex: 1,
                      p: 3, 
                      borderRadius: 2, 
                      backgroundColor: 'rgba(0,0,0,0.2)',
                      border: '1px solid rgba(104, 29, 219, 0.15)',
                      position: 'relative',
                      overflow: 'hidden',
                      boxShadow: '0 4px 15px rgba(0,0,0,0.1)',
                      '&::before': {
                        content: '""',
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '4px',
                        height: '100%',
                        backgroundColor: '#14D854',
                      }
                    }}
                  >
                    <Typography variant="subtitle1" fontWeight="bold" color="white" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                      <FaTrophy color="#FFA500" size={16} />
                      Biggest Win
                    </Typography>
                    
                    {stats.biggestWin ? (
                      <Box sx={{ position: 'relative' }}>
                        <Typography 
                          variant="h3" 
                          fontWeight="bold" 
                          color="#14D854" 
                          sx={{ 
                            textShadow: '0 2px 5px rgba(0,0,0,0.5)',
                            position: 'relative',
                            zIndex: 2 
                          }}
                        >
                          {stats.biggestWin.payout} APTC
                        </Typography>
                        <Box 
                          sx={{ 
                            position: 'absolute', 
                            top: -10, 
                            right: -10, 
                            width: 80, 
                            height: 80, 
                            opacity: 0.2,
                            zIndex: 1
                          }}
                        >
                          <FaCoins color="#14D854" size={80} />
                        </Box>
                        <Typography variant="body2" color="rgba(255,255,255,0.7)" sx={{ mt: 1, position: 'relative', zIndex: 2 }}>
                          Your largest single payout so far
                        </Typography>
                      </Box>
                    ) : (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <FaExclamationCircle color="#FFA500" />
                        <Typography variant="body2" color="rgba(255,255,255,0.7)">
                          No wins recorded yet. Keep playing!
                        </Typography>
                      </Box>
                    )}
                  </Box>
                </Box>
                
                <Box 
                  sx={{ 
                    mt: 3, 
                    p: 2, 
                    borderRadius: 2, 
                    background: 'linear-gradient(135deg, rgba(104, 29, 219, 0.05) 0%, rgba(104, 29, 219, 0.15) 100%)',
                    border: '1px solid rgba(104, 29, 219, 0.15)',
                    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1
                  }}
                >
                  <FaInfoCircle color="#681DDB" style={{ flexShrink: 0 }} />
                  <Typography variant="body2" color="rgba(255,255,255,0.8)">
                    These statistics cover your most recent {stats.totalBets} bets with a lifetime ROI of {stats.roi.toFixed(1)}%.
                  </Typography>
                </Box>
              </Box>
            </Fade>
          )}
        </>
      )}
    </Paper>
  );
};

export default RouletteHistory; 